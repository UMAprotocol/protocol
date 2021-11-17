#!/usr/bin/env node

const { getContract, web3 } = require("hardhat");
const Voting = getContract("Voting");

const secondsPerDay = web3.utils.toBN(86400);

async function main() {
  const [account] = await web3.eth.getAccounts();
  const voting = await Voting.deployed();
  const startingPhase = await voting.methods.getVotePhase().call();
  const currentTime = web3.utils.toBN(await voting.methods.getCurrentTime().call());
  await voting.methods.setCurrentTime(currentTime.add(secondsPerDay)).send({ from: account });
  const endingPhase = await voting.methods.getVotePhase().call();
  console.log("Moved from phase", startingPhase.toString(), "to", endingPhase.toString());
}

main().then(
  () => {
    process.exit(0);
  },
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
