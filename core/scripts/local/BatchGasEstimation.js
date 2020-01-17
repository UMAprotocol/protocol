// This script Determins the max number of batched commits, reveals, and reward retrievals
// that can fit into a single txn

const { RegistryRolesEnum, VotePhasesEnum } = require("../../../common/Enums.js");
const { getRandomSignedInt, getRandomUnsignedInt } = require("../../../common/Random.js");
const { moveToNextRound, moveToNextPhase } = require("../../utils/Voting.js");

const Registry = artifacts.require("Registry");
const Voting = artifacts.require("Voting");
const VotingToken = artifacts.require("VotingToken");

async function run() {
  const voting = await Voting.deployed();
  const votingToken = await VotingToken.deployed();
  const registry = await Registry.deployed();

  const accounts = await web3.eth.getAccounts();
  const owner = accounts[0];
  const registeredDerivative = accounts[1];
  const voter = accounts[2];

  await voting.setInflationRate({ rawValue: web3.utils.toWei("0.01", "ether") });
  await registry.addMember(RegistryRolesEnum.DERIVATIVE_CREATOR, owner);

  if (!(await registry.isDerivativeRegistered(registeredDerivative))) {
    await registry.registerDerivative([], registeredDerivative, { from: owner });
  }

  const identifier = web3.utils.utf8ToHex("test-identifier");
  await voting.addSupportedIdentifier(identifier);

  // Allow owner to mint new tokens
  await votingToken.addMember("1", owner);

  const balance = await votingToken.balanceOf(voter);
  const floorBalance = web3.utils.toBN(web3.utils.toWei("100", "ether"));
  if (balance.lt(floorBalance)) {
    console.log("Minting tokens for", voter);
    await votingToken.mint(voter, web3.utils.toWei("100", "ether"));
  }

  // Pick a random time. Probabilistically, this won't request a duplicate time from a previous run.
  let time = Math.floor(Math.random() * (await voting.getCurrentTime()));

  let i = 64;
  let converged = false;
  let lowestFailed = 0;
  let highestPassed = 0;
  // Define all three cases we want to check for
  let tests = ["commit", "reveal", "claim"];

  for (j = 1; j < tests.length; j++) {
    console.log("Finding maximum batch size for", tests[j], "that can be run in one transaction.");
    while (!converged) {
      console.log("*size:", i, "*");
      if (lowestFailed - highestPassed == 1) {
        console.log("Maximum =", highestPassed);
        converged = true;
        break;
      }
      try {
        if (j == 0) {
          await cycleCommit(voting, identifier, time, i, registeredDerivative, voter);
        }
        if (j == 1) {
          await cycleReveal(voting, identifier, time, i, registeredDerivative, voter);
        }
        highestPassed = i;
        if (lowestFailed != 0) {
          i = Math.floor((lowestFailed + highestPassed) / 2);
        } else {
          i = i * 2;
        }
      } catch (error) {
        lowestFailed = i;
        i = Math.floor((lowestFailed + highestPassed) / 2);
      }
      time += 1;
    }
  }
  console.log("Done");
}

const cycleCommit = async (voting, identifier, time, requestNumber, registeredDerivative, voter) => {
  for (var i = 0; i < requestNumber; i++) {
    await voting.requestPrice(identifier, time + i, { from: registeredDerivative });
  }

  await moveToNextRound(voting);
  const salts = {};
  const price = getRandomSignedInt();
  const commitments = [];

  // Create the batch of commitments.
  for (var i = 0; i < requestNumber; i++) {
    const salt = getRandomUnsignedInt();
    const hash = web3.utils.soliditySha3(price, salt);
    salts[i] = salt;
    commitments[i] = { identifier: identifier, time: time + i, hash: hash, encryptedVote: [] };
  }

  // Reveal commitments.
  const result = await voting.batchCommit(commitments, { from: voter });
  console.log("batchCommit gas used:", result.receipt.gasUsed);
};

const cycleReveal = async (voting, identifier, time, requestNumber, registeredDerivative, voter) => {
  console.log("revealing");
  for (var i = 0; i < requestNumber; i++) {
    await voting.requestPrice(identifier, time + i, { from: registeredDerivative });
  }

  // Advance to commit phase
  await moveToNextRound(voting);

  const salts = {};
  const price = getRandomSignedInt();

  // Generate Commitments. We will use single commit so no upper bound on the number to generate.
  for (var i = 0; i < requestNumber; i++) {
    const salt = getRandomUnsignedInt();
    const hash = web3.utils.soliditySha3(price, salt);
    await voting.commitVote(identifier, time + i, hash, { from: voter });
    salts[i] = salt;
  }

  // Advance to reveal phase
  await moveToNextPhase(voting);

  let reveals = [];
  for (var i = 0; i < requestNumber; i++) {
    reveals[i] = { identifier: identifier, time: time + i, price: price.toString(), salt: salts[i].toString() };
  }
  const result = await voting.batchReveal(reveals, { from: voter });
  console.log("batchReveal gas used:", result.receipt.gasUsed);
};

module.exports = async function(cb) {
  try {
    await run();
  } catch (err) {
    console.log(err);
  }
  cb();
};
