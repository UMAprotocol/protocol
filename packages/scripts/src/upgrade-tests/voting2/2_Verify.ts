// This script verify that the upgrade was executed correctly.
// It can be run against a mainnet fork by spinning a node in a separate terminal with:
// HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy
// and then running this script with:
// VOTING_V2_ADDRESS=<VOTING-V2-ADDRESS> \
// GOVERNOR_V2_ADDRESS=<GOVERNOR-V2-ADDRESS> \
// PROPOSER_V2_ADDRESS=<PROPOSER-V2-ADDRESS> \
// PROPOSER_ADDRESS=<OPTIONAL-PROPOSER-ADDRESS> \
// GOVERNOR_ADDRESS=<OPTIONAL-GOVERNOR-ADDRESS> \
// VOTING_ADDRESS=<OPTONAL-VOTING-ADDRESS>\
// yarn hardhat run ./src/upgrade-tests/voting2/2_Verify.ts --network localhost

const hre = require("hardhat");
const assert = require("assert").strict;

import {
  FinderEthers,
  getAbi,
  GovernorEthers,
  RegistryEthers,
  VotingEthers,
  VotingV2Ethers,
  VotingTokenEthers,
  ProposerEthers,
} from "@uma/contracts-node";

import { getContractInstance } from "../../utils/contracts";
import {
  checkEnvVariables,
  getMultiRoleContracts,
  getOwnableContracts,
  isContractInstance,
  NEW_CONTRACTS,
  OLD_CONTRACTS,
} from "./migrationUtils";
const { interfaceName } = require("@uma/common");

const multiRoleABI = getAbi("MultiRole");
const ownableABI = getAbi("Ownable");

async function main() {
  const networkId = Number(await hre.getChainId());
  const provider = hre.ethers.provider;

  const ownableContractsToMigrate = await getOwnableContracts(networkId);
  const multiRoleContractsToMigrate = await getMultiRoleContracts(networkId);

  checkEnvVariables();

  const finder = await getContractInstance<FinderEthers>("Finder");
  const registry = await getContractInstance<RegistryEthers>("Registry");
  const votingToken = await getContractInstance<VotingTokenEthers>("VotingToken");

  const governor = await getContractInstance<GovernorEthers>("Governor", process.env[OLD_CONTRACTS.governor]);
  const oldVoting = await getContractInstance<VotingEthers>("Voting", process.env[OLD_CONTRACTS.voting]);
  const proposer = await getContractInstance<ProposerEthers>("Proposer", process.env[OLD_CONTRACTS.proposer]);

  const votingV2 = await getContractInstance<VotingV2Ethers>("VotingV2", process.env[NEW_CONTRACTS.voting]);
  const proposerV2 = await getContractInstance<ProposerEthers>("Proposer", process.env[NEW_CONTRACTS.proposer]);
  const governorV2 = await getContractInstance<GovernorEthers>("Governor", process.env[NEW_CONTRACTS.governor]);

  console.log(" 1. Validating finder registration of new voting contract addresses...");
  assert.equal(
    (await finder.getImplementationAddress(hre.ethers.utils.formatBytes32String(interfaceName.Oracle))).toLowerCase(),
    votingV2.address.toLowerCase()
  );
  console.log("✅ Voting registered interfaces match!");

  console.log(" 2. Validating deployed contracts are owned by governor...");
  assert.equal((await votingV2.owner()).toLowerCase(), governorV2.address.toLowerCase());
  console.log("✅ New Voting correctly transferred ownership!");

  // Verify Ownable contracts
  for (const ownableContract of Object.entries(ownableContractsToMigrate)) {
    const contractAddress = ownableContract[1];
    const contractName = ownableContract[0];
    const ownable = new hre.ethers.Contract(contractAddress, ownableABI, provider);
    assert.equal((await ownable.owner()).toLowerCase(), governorV2.address.toLowerCase());
    console.log(`✅ ${contractName} correctly transferred ownership!`);
  }

  console.log(" 3. Validating deployed contracts multirole owner is set to governor v2...");
  assert.equal((await governor.getMember(0)).toLowerCase(), governorV2.address.toLowerCase());
  console.log("✅ Old governor owner role correctly set!");

  assert.equal((await governorV2.getMember(0)).toLowerCase(), governorV2.address.toLowerCase());
  console.log("✅ New governor owner role correctly set!");

  // Verify MultiRole contracts
  for (const multiRoleContract of Object.entries(multiRoleContractsToMigrate)) {
    const contractAddress = multiRoleContract[1];
    const contractName = multiRoleContract[0];
    const multirole = new hre.ethers.Contract(contractAddress, multiRoleABI, provider);
    assert.equal((await multirole.getMember(0)).toLowerCase(), governorV2.address.toLowerCase());
    console.log(`✅ ${contractName} owner role correctly set!`);
  }

  console.log(" 3. Old voting is validated and migrated to the correct address.");
  assert.equal((await oldVoting.migratedAddress()).toLowerCase(), votingV2.address.toLowerCase());
  console.log("✅ Voting has been successfully migrated!");

  console.log(" 4. Validating old voting contract and finder is owned by governor v2...");
  assert.equal(await oldVoting.owner(), governorV2.address);
  assert.equal(await finder.owner(), governorV2.address);
  console.log("✅ Old Voting & finder correctly transferred ownership back to governor v2!");

  console.log(" 5. Governor v2 is the owner of the voting token...");
  assert.equal((await votingToken.getMember(0)).toLowerCase(), governorV2.address.toLowerCase());
  console.log("✅ Voting token owner role correctly set!");

  console.log(" 6. Governor v2 is the owner of proposer...");
  assert.equal((await proposer.owner()).toLowerCase(), governorV2.address.toLowerCase());
  console.log("✅ Proposer owner role correctly set!");

  console.log(" 7. Governor v2 is the owner of proposer v2...");
  assert.equal((await proposerV2.owner()).toLowerCase(), governorV2.address.toLowerCase());
  console.log("✅ Proposer v2 owner role correctly set!");

  console.log(" 8. Governor v2 is registered in the registry...");
  assert(await registry.isContractRegistered(governorV2.address));
  console.log("✅ Governor v2 registered in registry!");

  console.log(" 9. Proposer v2 is registered in the regstry...");
  assert(await registry.isContractRegistered(proposerV2.address));
  console.log("✅ Proposer v2 registered in registry!");

  console.log(" 10. Governor v2 received all the voting tokens from Governor...");
  assert((await votingToken.balanceOf(governorV2.address)).gt(hre.web3.utils.toWei("30000000", "ether")));
  assert((await votingToken.balanceOf(governor.address)).eq(0));
  console.log("✅ Governor v2 received all the voting tokens from Governor!");

  console.log(" 11. Proposer v2 holds proposer role at Governor v2...");
  assert.equal((await governorV2.getMember(1)).toLowerCase(), proposerV2.address.toLowerCase());
  console.log("✅ New governor proposer role correctly set!");

  const isVotingV2 = await isContractInstance(votingV2.address, "stake(uint256)");
  if (isVotingV2) {
    console.log(" 12. New voting keeps track of old voting contract...");
    assert.equal((await votingV2.previousVotingContract()).toLowerCase(), oldVoting.address.toLowerCase());
    console.log("✅ New voting keeps track of old voting contract!");
  }

  console.log("\n✅ Verified! The upgrade process ends here.");

  console.log(
    "\n❓ OPTIONAL: Propose the downgrade to the previous governor, voting and proposer contracts by running the following command:"
  );
  console.log(
    "⚠️  This downgrade command is intended for testing purposes and should only be used against a fork or testnet. ⚠️"
  );
  console.log(
    `
  TEST_DOWNGRADE=1 \\
  ${OLD_CONTRACTS.voting}=${votingV2.address} \\
  ${NEW_CONTRACTS.voting}=${oldVoting.address} \\
  ${OLD_CONTRACTS.governor}=${governorV2.address} \\
  ${NEW_CONTRACTS.governor}=${governor.address} \\
  ${OLD_CONTRACTS.proposer}=${proposerV2.address} \\
  ${NEW_CONTRACTS.proposer}=${proposer.address} \\
  yarn hardhat run ./src/upgrade-tests/voting2/1_Propose.ts --network ${hre.network.name}`.replace(/  +/g, "")
  );
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
