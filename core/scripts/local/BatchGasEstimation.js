// This script Determines the max number of batched commits, reveals, and reward retrievals
// that can fit into a single txn. This is done by creating a set of price requests and then
// progressively committing, revealing and claiming rewards until the transaction reverts for
// a given size. A binary search mechanism is used to reduce the number of iterations required
// to find the max number that can fit within one transaction.

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

  // Transfer tokens to the voter such they they have enough to pass all votes on their own
  const ownerBalance = await votingToken.balanceOf(owner);
  await votingToken.transfer(voter, ownerBalance, { from: owner });

  // Pick a random time. Probabilistically, this won't request a duplicate time from a previous run.
  let time = 0;

  let requestNum = 64;
  let converged = false;
  let lowestFailed = 0;
  let highestPassed = 0;
  // Define all three cases we want to check for
  let tests = ["batchCommit", "batchReveal", "retrieveRewards"];

  for (j = 0; j <= tests.length; j++) {
    console.log("Finding maximum batch size for", tests[j], "that can be run in one transaction.");
    while (!converged) {
      console.log("*size:", requestNum, "*");
      if (lowestFailed - highestPassed == 1) {
        console.log("Maximum =", highestPassed);
        converged = true;
        break;
      }
      try {
        if (j == 0) {
          await cycleCommit(voting, identifier, time, requestNum, registeredDerivative, voter);
        }
        if (j == 1) {
          await cycleReveal(voting, identifier, time, requestNum, registeredDerivative, voter);
        }
        if (j == 2) {
          await cycleClaim(voting, identifier, time, requestNum, registeredDerivative, voter);
        }
        highestPassed = requestNum;
        if (lowestFailed != 0) {
          requestNum = Math.floor((lowestFailed + highestPassed) / 2);
        } else {
          requestNum = requestNum * 2;
        }
      } catch (error) {
        lowestFailed = requestNum;
        requestNum = Math.floor((lowestFailed + highestPassed) / 2);
      }
      time = Math.floor(Math.random() * (await voting.getCurrentTime()));
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

const cycleClaim = async (voting, identifier, time, requestNumber, registeredDerivative, voter) => {
  for (var i = 0; i < requestNumber; i++) {
    await voting.requestPrice(identifier, time + i, { from: registeredDerivative });
  }
  await moveToNextRound(voting);

  const salts = {};
  const price = getRandomSignedInt();

  for (var i = 0; i < requestNumber; i++) {
    const salt = getRandomUnsignedInt();
    const hash = web3.utils.soliditySha3(price, salt);
    await voting.commitVote(identifier, time + i, hash, { from: voter });
    salts[i] = salt;
  }

  // Advance to reveal phase
  await moveToNextPhase(voting);

  for (var i = 0; i < requestNumber; i++) {
    await voting.revealVote(identifier, time + i, price, salts[i], { from: voter });
  }

  // Finally generate the batch rewards to retrieve
  let roundId = await voting.getCurrentRoundId();

  await moveToNextRound(voting);

  let pendingRequests = [];
  for (var i = 0; i < requestNumber; i++) {
    pendingRequests[i] = { identifier: identifier, time: time + i };
  }
  const result = await voting.retrieveRewards(voter, roundId, pendingRequests, { from: voter });
  console.log("retrieveRewards gas used:", result.receipt.gasUsed);
};

module.exports = async function(cb) {
  try {
    await run();
  } catch (err) {
    console.log(err);
  }
  cb();
};
