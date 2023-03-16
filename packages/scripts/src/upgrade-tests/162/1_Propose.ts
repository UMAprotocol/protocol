// This script generates and submits an upgrade transaction to add/upgrade the optimistic oracle in the DVM in
// the mainnet and layer 2 blockchains. It can be run on a local hardhat node fork of the mainnet or can be run
// directly on the mainnet to execute the upgrade transactions.
// To run this on the localhost first fork mainnet into a local hardhat node by running:
// HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy
// Then execute the script:
// OPTIMISTIC_ORACLE_V2_10=<OPTIMISM-OOV2-ADDRESS> \
// NODE_URL_10=<OPTIMISM-NODE-URL> \
// \
// OPTIMISTIC_ORACLE_V2_288=<BOBA-OOV2-ADDRESS> \
// NODE_URL_288=<OPTIMISM-NODE-URL> \
// \
// OPTIMISTIC_ORACLE_V2_137=<POLYGON-OOV2-ADDRESS> \
// NODE_URL_137=<OPTIMISM-NODE-URL> \
// \
// OPTIMISTIC_ORACLE_V2_42161=<ARBITRUM-OOV2-ADDRESS> \
// NODE_URL_42161=<OPTIMISM-NODE-URL> \
// \
// OPTIMISTC_ORACLE_V2=<MAINNET-OOV2-ADDRESS> \
// \
// yarn hardhat run ./src/upgrade-tests/162/1_Propose.ts  --network localhost

const hre = require("hardhat");

const { RegistryRolesEnum } = require("@uma/common");
import { BigNumberish } from "@ethersproject/bignumber";
import { BytesLike } from "@ethersproject/bytes";
import {
  ArbitrumParentMessenger,
  Finder,
  Governor,
  GovernorHub,
  GovernorRootTunnel,
  Proposer,
  Registry,
} from "@uma/contracts-node/typechain/core/ethers";
import { BaseContract, PopulatedTransaction, Signer } from "ethers";
import { getContractInstance, getContractInstanceByUrl } from "../../utils/contracts";

// PARAMETERS
const proposerWallet = "0x2bAaA41d155ad8a4126184950B31F50A1513cE25";
const deployed_optimistic_oracle_address = process.env["OPTIMISTC_ORACLE_V2"];

const OPTIMISTIC_ORACLE_V2 = "OptimisticOracleV2"; // TODO use interfaceName.OptimisticOracle

// CONSTANTS
const POLYGON_CHAIN_ID = 137;
const ARBITRUM_CHAIN_ID = 42161;

// Env vars
const NODE_URL_ENV = "NODE_URL_";
const OPTIMISTIC_ORACLE_V2_ENV = "OPTIMISTIC_ORACLE_V2_";

export interface RelayProposal {
  to: string;
  value: BigNumberish;
  data: BytesLike;
  chainId: BigNumberish;
}
export interface RelayRecords {
  block: number;
  governorRootTunnel: RelayProposal[];
  governorHub: RelayProposal[];
}

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
  console.log("RelayGovernanceData", relayGovernanceData);
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
  // TODO We should group the GovernorHub relays by chain id instead of running a relayGovernance per
  // function call.
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
  chainId: number,
  relayRecords: RelayRecords
): Promise<{
  to: string;
  value: BigNumberish;
  data: BytesLike;
}> => {
  // The l1 governor for polygon is the GovernorRootTunnel and the l1 governor for the rest of l2's is the GovernorHub
  const isPolygon = chainId === POLYGON_CHAIN_ID;
  let proposal;
  if (isPolygon) {
    proposal = await relayGovernanceRootTunnelMessage(targetAddress, tx, l1Governor as GovernorRootTunnel);
    relayRecords.governorRootTunnel.push({ to: targetAddress, value: 0, data: tx.data || "", chainId });
  } else {
    proposal = await relayGovernanceHubMessage(targetAddress, tx, l1Governor as GovernorHub, chainId);
    relayRecords.governorHub.push({ to: targetAddress, value: 0, data: tx.data || "", chainId });
  }
  return proposal;
};

const fundArbitrumParentMessengerForRelays = async (
  arbitrumParentMessenger: ArbitrumParentMessenger,
  from: Signer,
  totalNumberOfTransactions: BigNumberish
) => {
  // Sending a xchain transaction to Arbitrum will fail unless Arbitrum messenger has enough ETH to pay for message:
  const l1CallValue = await arbitrumParentMessenger.getL1CallValue();
  console.log(
    `Arbitrum xchain messages require that the Arbitrum_ParentMessenger has at least a ${hre.ethers.utils.formatEther(
      l1CallValue.mul(totalNumberOfTransactions)
    )} ETH balance.`
  );

  const apmBalance = await arbitrumParentMessenger.provider.getBalance(arbitrumParentMessenger.address);

  if (apmBalance.lt(l1CallValue.mul(totalNumberOfTransactions))) {
    const amoutToSend = l1CallValue.mul(totalNumberOfTransactions).sub(apmBalance);
    console.log(`Sending ${hre.ethers.utils.formatEther(amoutToSend)} ETH to Arbitrum_ParentMessenger`);

    const sendEthTxn = await from.sendTransaction({
      to: arbitrumParentMessenger.address,
      value: amoutToSend,
    });

    console.log(`Sent ETH txn: ${sendEthTxn.hash}`);
  } else {
    console.log("Arbitrum messenger has enough ETH");
  }
};

async function main() {
  const proposerSigner = await hre.ethers.getSigner(proposerWallet);

  const finder = await getContractInstance<Finder>("Finder");
  const governor = await getContractInstance<Governor>("Governor");
  const registry = await getContractInstance<Registry>("Registry");
  const proposer = await getContractInstance<Proposer>("Proposer");
  const arbitrumParentMessenger = await getContractInstance<ArbitrumParentMessenger>("Arbitrum_ParentMessenger");

  const governorRootTunnel = await getContractInstance<GovernorRootTunnel>("GovernorRootTunnel"); // for polygon
  const governorHub = await getContractInstance<GovernorHub>("GovernorHub"); // rest of l2

  const l2Networks = { BOBA: 288, MATIC: 137, OPTIMISM: 10, ARBITRUM: 42161 };

  const adminProposalTransactions: {
    to: string;
    value: BigNumberish;
    data: BytesLike;
  }[] = [];

  const relayRecords: RelayRecords = {
    block: await finder.provider.getBlockNumber(),
    governorHub: [],
    governorRootTunnel: [],
  };

  if (!deployed_optimistic_oracle_address) throw new Error("No deployed_optimistic_oracle_address");

  for (const networkName in l2Networks) {
    const l2ChainId = l2Networks[networkName as keyof typeof l2Networks];
    const l2NodeUrl = process.env[String(NODE_URL_ENV + l2ChainId)];
    const l2OptimisticOracleV2Address = process.env[String(OPTIMISTIC_ORACLE_V2_ENV + l2ChainId)];

    if (!l2NodeUrl || !l2OptimisticOracleV2Address) throw new Error(`Missing ${networkName} network config`);

    const isPolygon = l2ChainId === POLYGON_CHAIN_ID;
    const isArbitrum = l2ChainId === ARBITRUM_CHAIN_ID;

    const l2Registry = await getContractInstanceByUrl<Registry>("Registry", l2NodeUrl);

    // The l2Governor in polygon is the GovernorChildTunnel and in the rest of the l2's is the GovernorHub
    const l2Governor = await getContractInstanceByUrl<BaseContract>(
      isPolygon ? "GovernorChildTunnel" : "GovernorSpoke",
      l2NodeUrl
    );
    const l2Finder = await getContractInstanceByUrl<Finder>("Finder", l2NodeUrl);

    if (await l2Registry.isContractRegistered(l2OptimisticOracleV2Address)) continue;

    console.log(`Registering ${l2OptimisticOracleV2Address} on ${networkName}`);

    // Fund Arbitrum if needed for next 4 transactions
    if (isArbitrum) await fundArbitrumParentMessengerForRelays(arbitrumParentMessenger, proposerSigner, 4);

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
        l2ChainId,
        relayRecords
      )
    );

    console.log("AddMemberData", addMemberDataTx);

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
        l2ChainId,
        relayRecords
      )
    );

    console.log("RegisterOptimisticOracleData", registerOptimisticOracleData);

    // 3. Remove the l2Governor from being a contract creator.
    const removeMemberData = await l2Registry.populateTransaction.removeMember(
      RegistryRolesEnum.CONTRACT_CREATOR,
      l2Governor.address
    );

    adminProposalTransactions.push(
      await relayGovernanceMessage(
        l2Registry.address,
        removeMemberData,
        isPolygon ? governorRootTunnel : governorHub,
        l2ChainId,
        relayRecords
      )
    );

    console.log("RemoveMemberData", removeMemberData);

    // 4. Set contract in finder.
    const setFinderData = await l2Finder.populateTransaction.changeImplementationAddress(
      hre.ethers.utils.formatBytes32String(OPTIMISTIC_ORACLE_V2),
      l2OptimisticOracleV2Address
    );

    adminProposalTransactions.push(
      await relayGovernanceMessage(
        l2Finder.address,
        setFinderData,
        isPolygon ? governorRootTunnel : governorHub,
        l2ChainId,
        relayRecords
      )
    );

    console.log("ChangeImplementationAddressData", setFinderData);
  }

  if (!(await registry.isContractRegistered(deployed_optimistic_oracle_address))) {
    console.log(`Registering ${deployed_optimistic_oracle_address} on mainnet`);
    // Mainnet
    // 1. Temporarily add the Governor as a contract creator.
    const addGovernorToRegistryTx = await registry.populateTransaction.addMember(
      RegistryRolesEnum.CONTRACT_CREATOR,
      governor.address
    );
    if (!addGovernorToRegistryTx.data) throw new Error("addGovernorToRegistryTx.data is empty");
    console.log("AddGovernorToRegistryTx", addGovernorToRegistryTx);
    adminProposalTransactions.push({ to: registry.address, value: 0, data: addGovernorToRegistryTx.data });

    // 2. Register the OptimisticOracle as a verified contract.
    const registerOptimisticOracleTx = await registry.populateTransaction.registerContract(
      [],
      deployed_optimistic_oracle_address
    );
    if (!registerOptimisticOracleTx.data) throw new Error("registerOptimisticOracleTx.data is empty");
    console.log("RegisterOptimisticOracleTx", registerOptimisticOracleTx);
    adminProposalTransactions.push({ to: registry.address, value: 0, data: registerOptimisticOracleTx.data });

    // 3. Remove the Governor from being a contract creator.
    const removeGovernorFromRegistryTx = await registry.populateTransaction.removeMember(
      RegistryRolesEnum.CONTRACT_CREATOR,
      governor.address
    );
    if (!removeGovernorFromRegistryTx.data) throw new Error("removeGovernorFromRegistryTx.data is empty");
    console.log("RemoveGovernorFromRegistryTx", removeGovernorFromRegistryTx);
    adminProposalTransactions.push({ to: registry.address, value: 0, data: removeGovernorFromRegistryTx.data });

    // 4. Add the OptimisticOracle to the Finder.
    const addOptimisticOracleToFinderTx = await finder.populateTransaction.changeImplementationAddress(
      hre.ethers.utils.formatBytes32String(OPTIMISTIC_ORACLE_V2),
      deployed_optimistic_oracle_address
    );
    if (!addOptimisticOracleToFinderTx.data) throw new Error("addOptimisticOracleToFinderTx.data is empty");
    console.log("AddOptimisticOracleToFinderTx", addOptimisticOracleToFinderTx);
    adminProposalTransactions.push({ to: finder.address, value: 0, data: addOptimisticOracleToFinderTx.data });
  }

  console.log("Proposing...");

  const tx = await proposer.connect(proposerSigner).propose(adminProposalTransactions, {
    gasLimit: 10_000_000,
  });

  console.log("Proposal Done.");

  console.log("PROPOSAL DATA:");
  console.log(tx.data);
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
