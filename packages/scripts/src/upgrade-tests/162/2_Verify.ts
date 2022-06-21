// This script verify that the upgrade was executed correctly. It can be
// run on a local hardhat node fork of the mainnet or can be run directly on the mainnet to execute the upgrade
// transactions. To run this on the localhost first fork mainnet into a local hardhat node by running:
// HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy
// Then execute the script from core:
// OPTIMISTC_ORACLE_V2=<OPTIMISTC-ORACLE-V2-ADDRESS> yarn hardhat run ./src/upgrade-tests/162/2_Verify.ts --network localhost

const hre = require("hardhat");
import * as path from "path";
import fs from "fs";
const assert = require("assert").strict;

const { RegistryRolesEnum, interfaceName } = require("@uma/common");
const { getAddress } = require("@uma/contracts-node");

import { Finder, Governor, GovernorHub, GovernorRootTunnel, Registry } from "@uma/contracts-node/typechain/core/ethers";
import { getContractInstance } from "../../utils/contracts";
import { RelayProposal, RelayRecords } from "./1_Propose";

const OPTIMISTIC_ORACLE_V2 = "OptimisticOracleV2"; // TODO use interfaceName.OptimisticOracle
const deployed_optimistic_oracle_address = process.env["OPTIMISTC_ORACLE_V2"];

const verifyGovernanceHubMessage = async (
  governorHub: GovernorHub,
  relayProposal: RelayProposal,
  fromBlock: number
) => {
  const relayedTransactions = await governorHub.filters.RelayedGovernanceRequest(
    relayProposal.chainId,
    undefined,
    undefined,
    undefined
  );

  const events = await governorHub.queryFilter(relayedTransactions, fromBlock, "latest");

  const found = events.find(
    (e) => e.args.calls[0].data === relayProposal.data && e.args.calls[0].to == relayProposal.to
  );
  assert(found, "Could not find RelayedGovernanceRequest matching expected relayed message");
};

const verifyGovernanceRootTunnelMessage = async (
  governorRootTunnel: GovernorRootTunnel,
  relayProposal: RelayProposal,
  fromBlock: number
) => {
  const relayedTransactions = await governorRootTunnel.filters.RelayedGovernanceRequest(relayProposal.to, undefined);
  const events = await governorRootTunnel.queryFilter(relayedTransactions, fromBlock, "latest");

  assert(
    events.find((e) => e.args.data === relayProposal.data),
    "Could not find RelayedGovernanceRequest matching expected relayed transaction"
  );
};

async function main() {
  if (!deployed_optimistic_oracle_address) throw new Error("OPTIMISTC_ORACLE_V2 environment variable not set");
  const networkId = await hre.getChainId();
  const finder = await getContractInstance<Finder>("Finder");
  const governor = await getContractInstance<Governor>("Governor");
  const registry = await getContractInstance<Registry>("Registry");

  const governorRootTunnel = await getContractInstance<GovernorRootTunnel>("GovernorRootTunnel"); // for polygon
  const governorHub = await getContractInstance<GovernorHub>("GovernorHub"); // rest of l2

  const adminProposalTransactionsFile = path.join(path.dirname(__filename), "response.json");

  // read file
  const adminProposalTransactions: RelayRecords = JSON.parse(fs.readFileSync(adminProposalTransactionsFile, "utf8"));

  console.log("Verifying GovernorHub relays...");
  adminProposalTransactions.governorHub.forEach((relay) =>
    verifyGovernanceHubMessage(governorHub, relay, adminProposalTransactions.block)
  );
  console.log("Verified!");

  console.log("Verifying GovernorRootTunnel relays...");
  adminProposalTransactions.governorRootTunnel.forEach((relay) =>
    verifyGovernanceRootTunnelMessage(governorRootTunnel, relay, adminProposalTransactions.block)
  );
  console.log("Verified!");

  console.log("Verifying that Governor doesn't hold the creator role...");
  !(await registry.holdsRole(RegistryRolesEnum.CONTRACT_CREATOR, governor.address));
  console.log("Verified!");

  console.log("Verifying that the OptimisticOracleV2 is registered with the Registry...");
  assert(await registry.isContractRegistered(deployed_optimistic_oracle_address));
  console.log("Verified!");

  console.log("Verifying that the OptimisticOracleV2 is registered with the Finder...");
  assert.equal(
    (await finder.getImplementationAddress(hre.ethers.utils.formatBytes32String(OPTIMISTIC_ORACLE_V2))).toLowerCase(),
    deployed_optimistic_oracle_address.toLowerCase()
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
