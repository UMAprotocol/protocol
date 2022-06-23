// This script verify that the upgrade was executed correctly. It can be
// run on a local hardhat node fork of the mainnet or can be run directly on the mainnet to execute the upgrade
// transactions. To run this on the localhost first fork mainnet into a local hardhat node by running:
// HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy
// Then execute the script from core with the PROPOSAL_DATA logged by ./src/upgrade-tests/162/1_Propose.ts:
// PROPOSAL_DATA=<PROPOSAL_DATA> yarn hardhat run ./src/upgrade-tests/162/2_Verify.ts --network localhost

const hre = require("hardhat");
const assert = require("assert").strict;

const { TransactionDataDecoder } = require("@uma/financial-templates-lib");

const { RegistryRolesEnum, interfaceName } = require("@uma/common");
const { getAddress } = require("@uma/contracts-node");

import { Finder, Governor, GovernorHub, GovernorRootTunnel, Registry } from "@uma/contracts-node/typechain/core/ethers";
import { getContractInstance } from "../../utils/contracts";

// CONSTANTS
const OPTIMISTIC_ORACLE_V2 = "OptimisticOracleV2"; // TODO use interfaceName.OptimisticOracle

function decodeData(data: string) {
  return TransactionDataDecoder.getInstance().decodeTransaction(data);
}

const verifyGovernanceHubMessage = async (
  governorHub: GovernorHub,
  relayProposal: RelayTransaction,
  fromBlock: number
) => {
  const relayedTransactions = await governorHub.filters.RelayedGovernanceRequest(
    Number(relayProposal.transaction.params?.chainId),
    undefined,
    undefined,
    undefined
  );

  const events = await governorHub.queryFilter(relayedTransactions, fromBlock, "latest");

  const found = events.find(
    (e) =>
      e.args.calls[0].data === relayProposal.transaction.params?.calls[0].data &&
      e.args.calls[0].to == relayProposal.transaction.params?.calls[0].to
  );
  assert(found, "Could not find RelayedGovernanceRequest matching expected relayed message");
};

const verifyGovernanceRootTunnelMessage = async (
  governorRootTunnel: GovernorRootTunnel,
  relayProposal: RelayTransaction,
  fromBlock: number
) => {
  const relayedTransactions = await governorRootTunnel.filters.RelayedGovernanceRequest(
    relayProposal.transaction.params.to,
    undefined
  );
  const events = await governorRootTunnel.queryFilter(relayedTransactions, fromBlock, "latest");

  assert(
    events.find((e) => e.args.data === relayProposal.transaction.params?.data),
    "Could not find RelayedGovernanceRequest matching expected relayed transaction"
  );
};

interface ProposedTransaction {
  to: string;
  data: string;
  value: string;
}

interface RelayTransaction {
  to: string;
  transaction: {
    name: string;
    params: {
      to: string;
      data?: string;
      chainId?: string;
      calls: { to: string; data: string }[];
    };
  };
}

async function main() {
  const callData = process.env["PROPOSAL_DATA"];
  if (!callData) throw new Error("PROPOSAL_DATA environment variable not set");

  const decodedData = decodeData(callData);

  const networkId = await hre.getChainId();
  const finder = await getContractInstance<Finder>("Finder");
  const governor = await getContractInstance<Governor>("Governor");
  const registry = await getContractInstance<Registry>("Registry");

  const startLookupBlock = (await await registry.provider.getBlockNumber()) - 250; // ~ 1hour ago

  const decodedSubTransactions = decodedData.params.transactions.map((transaction: ProposedTransaction) => ({
    to: transaction.to,
    transaction: decodeData(transaction.data),
  }));

  const governorRootRelays: RelayTransaction[] = [];
  const governorHubRelays: RelayTransaction[] = [];

  decodedSubTransactions.forEach((relayTransaction: RelayTransaction) => {
    if (relayTransaction.transaction.name === "relayGovernance") {
      if (relayTransaction.transaction.params.calls) {
        governorHubRelays.push(relayTransaction);
      } else {
        governorRootRelays.push(relayTransaction);
      }
    }
  });

  const registryL1Calls = decodedData.params.transactions.filter(
    (transaction: ProposedTransaction) => transaction.to === registry.address
  );

  const registerContractTransactions = registryL1Calls.find(
    (transaction: ProposedTransaction) => decodeData(transaction.data).name === "registerContract"
  );

  const optimisticOracleTx = decodeData(registerContractTransactions.data);

  const optimisticOracleV2AddressMainnet = optimisticOracleTx.params.contractAddress;

  const governorRootTunnel = await getContractInstance<GovernorRootTunnel>("GovernorRootTunnel"); // for polygon
  const governorHub = await getContractInstance<GovernorHub>("GovernorHub"); // rest of l2

  console.log("Verifying GovernorHub relays...");
  for (const relay of governorHubRelays) {
    await verifyGovernanceHubMessage(governorHub, relay, startLookupBlock);
  }
  console.log("Verified!");

  console.log("Verifying GovernorRootTunnel relays...");
  for (const relay of governorRootRelays) {
    await verifyGovernanceRootTunnelMessage(governorRootTunnel, relay, startLookupBlock);
  }
  console.log("Verified!");

  console.log("Verifying that Governor doesn't hold the creator role...");
  !(await registry.holdsRole(RegistryRolesEnum.CONTRACT_CREATOR, governor.address));
  console.log("Verified!");

  console.log("Verifying that the OptimisticOracleV2 is registered with the Registry...");
  assert(await registry.isContractRegistered(optimisticOracleV2AddressMainnet));
  console.log("Verified!");

  console.log("Verifying that the OptimisticOracleV2 is registered with the Finder...");
  assert.equal(
    (await finder.getImplementationAddress(hre.ethers.utils.formatBytes32String(OPTIMISTIC_ORACLE_V2))).toLowerCase(),
    optimisticOracleV2AddressMainnet.toLowerCase()
  );
  console.log("Verified!");

  console.log("Verifying that the OptimisticOracleV1 is still registered with the Registry...");
  assert(await registry.isContractRegistered(await getAddress(interfaceName.OptimisticOracle, Number(networkId))));
  console.log("Verified!");

  console.log("Verifying that the OptimisticOracleV1 is still registered with the Finder...");
  assert.equal(
    (
      await finder.getImplementationAddress(hre.ethers.utils.formatBytes32String(interfaceName.OptimisticOracle))
    ).toLowerCase(),
    await getAddress(interfaceName.OptimisticOracle, Number(networkId))
  );
  console.log("Verified!");

  console.log("Upgrade Verified!");
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
