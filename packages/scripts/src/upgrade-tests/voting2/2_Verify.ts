// This script verify that the upgrade was executed correctly.
// It can be run against a mainnet fork by spinning a node in a separate terminal with:
// HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy
// and then running this script with:
// VOTING_UPGRADER_ADDRESS= <VOTING-UPGRADER-ADDRESS> \
// VOTING_V2_ADDRESS= <VOTING-V2-ADDRESS> \
// GOVERNOR_V2_ADDRESS= <GOVERNOR-V2-ADDRESS> \
// yarn hardhat run ./src/upgrade-tests/voting2/2_Verify.ts --network localhost

const hre = require("hardhat");
const assert = require("assert").strict;

import { FinancialContractsAdmin } from "@uma/contracts-frontend/dist/typechain/core/ethers";
import { ProposerEthers } from "@uma/contracts-node";
import { OracleHub } from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers";
import {
  AddressWhitelist,
  ArbitrumParentMessenger,
  Finder,
  Governor,
  GovernorHub,
  GovernorRootTunnel,
  IdentifierWhitelist,
  OptimismParentMessenger,
  Registry,
  Store,
  Voting,
  VotingV2__factory,
} from "@uma/contracts-node/typechain/core/ethers";
import { getContractInstance } from "../../utils/contracts";
const { interfaceName } = require("@uma/common");

const { getContractFactory } = hre.ethers;

async function main() {
  const votingV2Address = process.env["VOTING_V2_ADDRESS"];
  const governorV2Address = process.env["GOVERNOR_V2_ADDRESS"];

  if (!votingV2Address) throw new Error("VOTING_V2_ADDRESS not set");
  if (!governorV2Address) throw new Error("GOVERNOR_V2_ADDRESS not set");

  const finder = await getContractInstance<Finder>("Finder");
  const governor = await getContractInstance<Governor>("Governor");
  const oldVoting = await getContractInstance<Voting>("Voting");

  // Ownable contracts
  const identifierWhitelist = await getContractInstance<IdentifierWhitelist>("IdentifierWhitelist");
  const financialContractsAdmin = await getContractInstance<FinancialContractsAdmin>("FinancialContractsAdmin");
  const addressWhitelist = await getContractInstance<AddressWhitelist>("AddressWhitelist");
  const governorRootTunnel = await getContractInstance<GovernorRootTunnel>("GovernorRootTunnel");
  const arbitrumParentMessenger = await getContractInstance<ArbitrumParentMessenger>("Arbitrum_ParentMessenger");
  const oracleHub = await getContractInstance<OracleHub>("OracleHub");
  const governorHub = await getContractInstance<GovernorHub>("GovernorHub");
  const bobaParentMessenger = await getContractInstance<OptimismParentMessenger>("Optimism_ParentMessenger");
  const optimismParentMessenger = await getContractInstance<OptimismParentMessenger>("Optimism_ParentMessenger");
  const proposer = await getContractInstance<ProposerEthers>("Proposer");

  // MultiRole contracts
  const registry = await getContractInstance<Registry>("Registry");
  const store = await getContractInstance<Store>("Store");

  const votingV2Factory: VotingV2__factory = await getContractFactory("VotingV2");
  const votingV2 = await votingV2Factory.attach(votingV2Address);

  console.log(" 1. Validating finder registration of new voting contract addresses...");
  assert.equal(
    (await finder.getImplementationAddress(hre.ethers.utils.formatBytes32String(interfaceName.Oracle))).toLowerCase(),
    votingV2Address.toLowerCase()
  );
  console.log("✅ Voting registered interfaces match!");

  console.log(" 2. Validating deployed contracts are owned by governor...");
  assert.equal((await votingV2.owner()).toLowerCase(), governorV2Address.toLowerCase());
  console.log("✅ New Voting correctly transferred ownership!");
  assert.equal((await identifierWhitelist.owner()).toLowerCase(), governorV2Address.toLowerCase());
  console.log("✅ IdentifierWhitelist correctly transferred ownership!");
  assert.equal((await financialContractsAdmin.owner()).toLowerCase(), governorV2Address.toLowerCase());
  console.log("✅ FinancialContractsAdmin correctly transferred ownership!");
  assert.equal((await addressWhitelist.owner()).toLowerCase(), governorV2Address.toLowerCase());
  console.log("✅ AddressWhitelist correctly transferred ownership!");
  assert.equal((await governorRootTunnel.owner()).toLowerCase(), governorV2Address.toLowerCase());
  console.log("✅ GovernorRootTunnel correctly transferred ownership!");
  assert.equal((await arbitrumParentMessenger.owner()).toLowerCase(), governorV2Address.toLowerCase());
  console.log("✅ ArbitrumParentMessenger correctly transferred ownership!");
  assert.equal((await oracleHub.owner()).toLowerCase(), governorV2Address.toLowerCase());
  console.log("✅ OracleHub correctly transferred ownership!");
  assert.equal((await governorHub.owner()).toLowerCase(), governorV2Address.toLowerCase());
  console.log("✅ GovernorHub correctly transferred ownership!");
  assert.equal((await bobaParentMessenger.owner()).toLowerCase(), governorV2Address.toLowerCase());
  console.log("✅ BobaParentMessenger correctly transferred ownership!");
  assert.equal((await optimismParentMessenger.owner()).toLowerCase(), governorV2Address.toLowerCase());
  console.log("✅ OptimismParentMessenger correctly transferred ownership!");
  assert.equal((await proposer.owner()).toLowerCase(), governorV2Address.toLowerCase());
  console.log("✅ Proposer correctly transferred ownership!");

  console.log(" 3. Validating deployed contracts multirole owner is set to governor v2...");
  assert.equal((await registry.getMember(0)).toLowerCase(), governorV2Address.toLowerCase());
  console.log("✅ Registry owner role correctly set!");
  assert.equal((await store.getMember(0)).toLowerCase(), governorV2Address.toLowerCase());
  console.log("✅ Store owner role correctly set!");
  assert.equal((await governor.getMember(0)).toLowerCase(), governorV2Address.toLowerCase());
  console.log("✅ Old governor owner role correctly set!");

  console.log(" 3. Old voting is validated and migrated to the correct address.");
  assert.equal((await oldVoting.migratedAddress()).toLowerCase(), votingV2.address.toLowerCase());
  console.log("✅ Voting has been successfully migrated!");

  console.log(" 4. Validating old voting contract and finder is owned by governor v2...");
  assert.equal(await oldVoting.owner(), governorV2Address);
  assert.equal(await finder.owner(), governorV2Address);
  console.log("✅ Old Voting & finder correctly transferred ownership back to governor v2!");

  console.log("Verified!");
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
