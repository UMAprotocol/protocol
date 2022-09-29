// This script verify that the upgrade was executed correctly.
// It can be run against a mainnet fork by spinning a node in a separate terminal with:
// HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy
// and then running this script with:
// VOTING_V2_ADDRESS= <VOTING-V2-ADDRESS> \
// GOVERNOR_V2_ADDRESS= <GOVERNOR-V2-ADDRESS> \
// yarn hardhat run ./src/upgrade-tests/voting2/2_Verify.ts --network localhost

const hre = require("hardhat");
const assert = require("assert").strict;

import {
  FinderEthers,
  getAbi,
  GovernorEthers,
  RegistryEthers,
  VotingEthers,
  VotingTokenEthers,
  VotingV2Ethers__factory,
} from "@uma/contracts-node";

import { getContractInstance } from "../../utils/contracts";
import { getMultiRoleContracts, getOwnableContracts } from "./migrationUtils";
const { interfaceName } = require("@uma/common");

const { getContractFactory } = hre.ethers;

const multiRoleABI = getAbi("MultiRole");
const ownableABI = getAbi("Ownable");

async function main() {
  const networkId = Number(await hre.getChainId());
  const provider = hre.ethers.provider;

  const ownableContractsToMigrate = await getOwnableContracts(networkId);
  const multiRoleContractsToMigrate = await getMultiRoleContracts(networkId);

  const votingV2Address = process.env["VOTING_V2_ADDRESS"];
  const governorV2Address = process.env["GOVERNOR_V2_ADDRESS"];
  const proposerV2Address = process.env["PROPOSER_V2_ADDRESS"];

  if (!votingV2Address) throw new Error("VOTING_V2_ADDRESS not set");
  if (!governorV2Address) throw new Error("GOVERNOR_V2_ADDRESS not set");
  if (!proposerV2Address) throw new Error("PROPOSER_V2_ADDRESS not set");

  const finder = await getContractInstance<FinderEthers>("Finder");
  const governor = await getContractInstance<GovernorEthers>("Governor");
  const registry = await getContractInstance<RegistryEthers>("Registry");
  const oldVoting = await getContractInstance<VotingEthers>("Voting");
  const votingToken = await getContractInstance<VotingTokenEthers>("VotingToken");

  const votingV2Factory: VotingV2Ethers__factory = await getContractFactory("VotingV2");
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

  // Verify Ownable contracts
  for (const ownableContract of Object.entries(ownableContractsToMigrate)) {
    const contractAddress = ownableContract[1];
    const contractName = ownableContract[0];
    const ownable = new hre.ethers.Contract(contractAddress, ownableABI, provider);
    assert.equal((await ownable.owner()).toLowerCase(), governorV2Address.toLowerCase());
    console.log(`✅ ${contractName} correctly transferred ownership!`);
  }

  console.log(" 3. Validating deployed contracts multirole owner is set to governor v2...");
  assert.equal((await governor.getMember(0)).toLowerCase(), governorV2Address.toLowerCase());
  console.log("✅ Old governor owner role correctly set!");

  // Verify MultiRole contracts
  for (const multiRoleContract of Object.entries(multiRoleContractsToMigrate)) {
    const contractAddress = multiRoleContract[1];
    const contractName = multiRoleContract[0];
    const multirole = new hre.ethers.Contract(contractAddress, multiRoleABI, provider);
    assert.equal((await multirole.getMember(0)).toLowerCase(), governorV2Address.toLowerCase());
    console.log(`✅ ${contractName} owner role correctly set!`);
  }

  console.log(" 3. Old voting is validated and migrated to the correct address.");
  assert.equal((await oldVoting.migratedAddress()).toLowerCase(), votingV2.address.toLowerCase());
  console.log("✅ Voting has been successfully migrated!");

  console.log(" 4. Validating old voting contract and finder is owned by governor v2...");
  assert.equal(await oldVoting.owner(), governorV2Address);
  assert.equal(await finder.owner(), governorV2Address);
  console.log("✅ Old Voting & finder correctly transferred ownership back to governor v2!");

  console.log(" 5. Governor v2 is the owner of the voting token...");
  assert.equal((await votingToken.getMember(0)).toLowerCase(), governorV2Address.toLowerCase());
  console.log("✅ Voting token owner role correctly set!");

  console.log(" 6. Governor v2 is registered in the registry...");
  assert(await registry.isContractRegistered(governorV2Address));
  console.log("✅ Governor v2 registered in registry!");

  console.log(" 7. Proposer v2 is registered in the regstry...");
  assert(await registry.isContractRegistered(proposerV2Address));
  console.log("✅ Proposer v2 registered in registry!");

  console.log(" 8. Governor v2 received all the voting tokens from Governor...");
  assert((await votingToken.balanceOf(governorV2Address)).gt(hre.web3.utils.toWei("30000000", "ether")));
  assert((await votingToken.balanceOf(governor.address)).eq(0));
  console.log("✅ Governor v2 received all the voting tokens from Governor!");

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
