// This script generates and submits an upgrade transaction to add/upgrade the optimistic oracle in the DVM. It can be
// run on a local hardhat node fork of the mainnet or can be run directly on the mainnet to execute the upgrade
// transactions. To run this on the localhost first fork mainnet into a local hardhat node by running:
// HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy
// Then execute the script from core:
// OPTIMISTC_ORACLE_V2=<OPTIMISTC-ORACLE-V2-ADDRESS> yarn hardhat run ./src/upgrade-tests/162/1_Propose.ts --network localhost

const hre = require("hardhat");

const { RegistryRolesEnum } = require("@uma/common");
import { BigNumberish } from "@ethersproject/bignumber";
import { BytesLike } from "@ethersproject/bytes";
import {
  Finder,
  Governor,
  GovernorHub,
  GovernorRootTunnel,
  Proposer,
  Registry,
} from "@uma/contracts-node/typechain/core/ethers";
import { PopulatedTransaction, BaseContract } from "ethers";
import { getContractInstance, getContractInstanceNetwork } from "../../utils/contracts";

// PARAMETERS
const proposerWallet = "0x2bAaA41d155ad8a4126184950B31F50A1513cE25";
const deployed_optimistic_oracle_address = process.env["OPTIMISTC_ORACLE_V2"];

const OPTIMISTIC_ORACLE_V2 = "OptimisticOracleV2"; // TODO use interfaceName.OptimisticOracle

// Constants
const POLYGON_ID = 137;

// Env vars
const NODE_URL_ENV = "NODE_URL_";
const OPTIMISTIC_ORACLE_V2_ENV = "OPTIMISTIC_ORACLE_V2_";

const relayGovernanceRootTunnelMessage = async (
  targetAddress: string,
  tx: PopulatedTransaction,
  governorRootTunnel: GovernorRootTunnel
): Promise<{
  to: string;
  value: BigNumberish;
  data: BytesLike;
}> => {
  if (!tx.data) throw new Error("Transaction has no data");
  const relayGovernanceData = await governorRootTunnel.populateTransaction.relayGovernance(targetAddress, tx.data);
  console.log("- relayGovernanceData", relayGovernanceData);
  const relay = await governorRootTunnel.populateTransaction.relayGovernance(targetAddress, tx.data);
  const relayMessage = relay.data;
  if (!relayMessage) throw new Error("Relay message is empty");
  return { to: governorRootTunnel.address, value: 0, data: relayMessage };
};

const relayGovernanceHubMessage = async (
  targetAddress: string,
  tx: PopulatedTransaction,
  governorHub: GovernorHub,
  chainId: BigNumberish
): Promise<{
  to: string;
  value: BigNumberish;
  data: BytesLike;
}> => {
  if (!tx.data) throw new Error("Transaction has no data");
  const calls = [{ to: targetAddress, data: tx.data }];
  const relayGovernanceData = await governorHub.populateTransaction.relayGovernance(chainId, calls);
  const relayMessage = relayGovernanceData.data;
  if (!relayMessage) throw new Error("Relay message is empty");
  return { to: governorHub.address, value: 0, data: relayMessage };
};

const relayGovernanceMessage = async (
  targetAddress: string,
  tx: PopulatedTransaction,
  l1Governor: GovernorHub | GovernorRootTunnel,
  chainId: BigNumberish
): Promise<{
  to: string;
  value: BigNumberish;
  data: BytesLike;
}> => {
  // The l1 governor for polygon is the GovernorRootTunnel and the l1 governor for the rest of l2's is the GovernorHub
  const isPolygon = chainId === POLYGON_ID;
  if (isPolygon) return relayGovernanceRootTunnelMessage(targetAddress, tx, l1Governor as GovernorRootTunnel);
  return relayGovernanceHubMessage(targetAddress, tx, l1Governor as GovernorHub, chainId);
};

async function main() {
  const proposerSigner = await hre.ethers.getSigner(proposerWallet);

  const finder = await getContractInstance<Finder>("Finder");
  const governor = await getContractInstance<Governor>("Governor");
  const registry = await getContractInstance<Registry>("Registry");
  const proposer = await getContractInstance<Proposer>("Proposer");

  const governorRootTunnel = await getContractInstance<GovernorRootTunnel>("GovernorRootTunnel"); // for polygon
  const governorHub = await getContractInstance<GovernorHub>("GovernorHub"); // rest of l2

  const l2Networks = { BOBA: 288, MATIC: 137, OPTIMISM: 10, ARBITRUM: 42161 };

  const adminProposalTransactions: {
    to: string;
    value: BigNumberish;
    data: BytesLike;
  }[] = [];

  for (const networkName in l2Networks) {
    const l2NetworkId = l2Networks[networkName as keyof typeof l2Networks];
    const l2NodeUrl = process.env[String(NODE_URL_ENV + l2NetworkId)];
    const l2OptimisticOracleV2Address = process.env[String(OPTIMISTIC_ORACLE_V2_ENV + l2NetworkId)];

    if (!l2NodeUrl || !l2OptimisticOracleV2Address) continue;

    const isPolygon = l2NetworkId === POLYGON_ID;

    const l2Registry = await getContractInstanceNetwork<Registry>("Registry", l2NodeUrl);

    // The l2Governor in polygon is the GovernorChildTunnel and in the rest of the l2's is the GovernorHub
    const l2Governor = await getContractInstanceNetwork<BaseContract>(
      isPolygon ? "GovernorChildTunnel" : "GovernorSpoke",
      l2NodeUrl
    );
    const l2Finder = await getContractInstanceNetwork<Finder>("Finder", l2NodeUrl);

    if (await l2Registry.isContractRegistered(l2OptimisticOracleV2Address)) continue;

    console.log(`Registering ${l2OptimisticOracleV2Address} on ${networkName}`);

    // 1. Temporarily add the GovernorChildTunnel/GovernorSpoke  as a contract creator.
    const addMemberDataTx = await l2Registry.populateTransaction.addMember(
      RegistryRolesEnum.CONTRACT_CREATOR,
      l2Governor.address
    );
    adminProposalTransactions.push(
      await relayGovernanceMessage(
        l2Registry.address,
        addMemberDataTx,
        isPolygon ? governorRootTunnel : governorHub,
        l2NetworkId
      )
    );

    console.log("- addMemberData", addMemberDataTx);

    // 2. Register the OptimisticOracle as a verified contract.
    const registerOptimisticOracleData = await l2Registry.populateTransaction.registerContract(
      [],
      l2OptimisticOracleV2Address
    );

    adminProposalTransactions.push(
      await relayGovernanceMessage(
        l2Registry.address,
        registerOptimisticOracleData,
        isPolygon ? governorRootTunnel : governorHub,
        l2NetworkId
      )
    );

    console.log("registerOptimisticOracleData", registerOptimisticOracleData);

    // 3. Remove the l2Governor from being a contract creator.
    const removeMemberData = await l2Registry.populateTransaction.removeMember(
      RegistryRolesEnum.CONTRACT_CREATOR,
      l2Governor.address
    );
    console.log("- removeMemberData", removeMemberData);

    adminProposalTransactions.push(
      await relayGovernanceMessage(
        l2Registry.address,
        removeMemberData,
        isPolygon ? governorRootTunnel : governorHub,
        l2NetworkId
      )
    );

    // 4. Set contract in finder.
    const setFinderData = await l2Finder.populateTransaction.changeImplementationAddress(
      hre.ethers.utils.formatBytes32String(OPTIMISTIC_ORACLE_V2),
      l2OptimisticOracleV2Address
    );

    console.log("- changeImplementationAddressData", setFinderData);

    adminProposalTransactions.push(
      await relayGovernanceMessage(
        l2Finder.address,
        setFinderData,
        isPolygon ? governorRootTunnel : governorHub,
        l2NetworkId
      )
    );
  }

  if (
    deployed_optimistic_oracle_address &&
    !(await registry.isContractRegistered(deployed_optimistic_oracle_address))
  ) {
    // Mainnet
    // 1. Temporarily add the Governor as a contract creator.
    const addGovernorToRegistryTx = await registry.populateTransaction.addMember(
      RegistryRolesEnum.CONTRACT_CREATOR,
      governor.address
    );
    if (!addGovernorToRegistryTx.data) throw new Error("addGovernorToRegistryTx.data is empty");
    console.log("addGovernorToRegistryTx", addGovernorToRegistryTx);
    adminProposalTransactions.push({ to: registry.address, value: 0, data: addGovernorToRegistryTx.data });

    // 2. Register the OptimisticOracle as a verified contract.
    const registerOptimisticOracleTx = await registry.populateTransaction.registerContract(
      [],
      deployed_optimistic_oracle_address
    );
    if (!registerOptimisticOracleTx.data) throw new Error("registerOptimisticOracleTx.data is empty");
    console.log("registerOptimisticOracleTx", registerOptimisticOracleTx);
    adminProposalTransactions.push({ to: registry.address, value: 0, data: registerOptimisticOracleTx.data });

    // 3. Remove the Governor from being a contract creator.
    const removeGovernorFromRegistryTx = await registry.populateTransaction.removeMember(
      RegistryRolesEnum.CONTRACT_CREATOR,
      governor.address
    );
    if (!removeGovernorFromRegistryTx.data) throw new Error("removeGovernorFromRegistryTx.data is empty");
    console.log("removeGovernorFromRegistryTx", removeGovernorFromRegistryTx);
    adminProposalTransactions.push({ to: registry.address, value: 0, data: removeGovernorFromRegistryTx.data });

    // 4. Add the OptimisticOracle to the Finder.
    const addOptimisticOracleToFinderTx = await finder.populateTransaction.changeImplementationAddress(
      hre.ethers.utils.formatBytes32String(OPTIMISTIC_ORACLE_V2),
      deployed_optimistic_oracle_address
    );
    if (!addOptimisticOracleToFinderTx.data) throw new Error("addOptimisticOracleToFinderTx.data is empty");
    console.log("addOptimisticOracleToFinderTx", addOptimisticOracleToFinderTx);
    adminProposalTransactions.push({ to: finder.address, value: 0, data: addOptimisticOracleToFinderTx.data });
  }

  console.log("Proposing...");

  await proposer.connect(proposerSigner).propose(adminProposalTransactions, {
    gasLimit: 10_000_000,
  });

  console.log("Proposal Done.");
}

main().then(
  () => {
    process.exit(0);
  },
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
