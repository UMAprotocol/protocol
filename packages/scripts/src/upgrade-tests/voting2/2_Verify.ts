// This script verify that the upgrade was executed correctly.
// It can be run against a mainnet fork by spinning a node in a separate terminal with:
// HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy
// and then running this script with:
// VOTING_V2_ADDRESS=<VOTING_V2_ADDRESS> \
// yarn hardhat run ./src/upgrade-tests/voting2/2_Verify.ts --network localhost

const hre = require("hardhat");
const assert = require("assert").strict;

import { Finder, Governor, Voting, VotingV2__factory } from "@uma/contracts-node/typechain/core/ethers";
import { getContractInstance } from "../../utils/contracts";
const { interfaceName } = require("@uma/common");

const { getContractFactory } = hre.ethers;

async function main() {
  const votingV2Address = process.env["VOTING_V2_ADDRESS"];

  if (!votingV2Address) throw new Error("VOTING_V2_ADDRESS not set");

  const finder = await getContractInstance<Finder>("Finder");
  const governor = await getContractInstance<Governor>("Governor");
  const oldVoting = await getContractInstance<Voting>("Voting");

  const votingV2Factory: VotingV2__factory = await getContractFactory("VotingV2");
  const votingV2 = await votingV2Factory.attach(votingV2Address);

  console.log(" 1. Validating finder registration of new voting contract addresses...");
  assert.equal(
    (await finder.getImplementationAddress(hre.ethers.utils.formatBytes32String(interfaceName.Oracle))).toLowerCase(),
    votingV2Address.toLowerCase()
  );
  console.log("✅ Voting registered interfaces match!");

  console.log(" 2. Validating deployed contracts are owned by governor...");
  assert.equal((await votingV2.owner()).toLowerCase(), governor.address.toLowerCase());
  console.log("✅ New Voting correctly transferred ownership!");

  console.log(" 3. Old voting is validated and migrated to the correct address.");
  assert.equal((await oldVoting.migratedAddress()).toLowerCase(), votingV2.address.toLowerCase());
  console.log("✅ Voting has been successfully migrated!");

  console.log(" 4. Validating old voting contract and finder is owned by governor...");
  assert.equal(await oldVoting.owner(), governor.address);
  assert.equal(await finder.owner(), governor.address);
  console.log("✅ Old Voting & finder correctly transferred ownership back to governor!");

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
