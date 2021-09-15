// This script Determines the max number of batched commits, reveals, and reward retrievals
// that can fit into a single txn. This is done by creating a set of price requests and then
// progressively committing, revealing and claiming rewards until the transaction reverts for
// a given size. A binary search mechanism is used to reduce the number of iterations required
// to find the max number that can fit within one transaction.

// Before you can run this script you must migrate all contracts to your local Ganache instance.
// Then, run the script with `truffle exec scripts/local/BatchGasEstimation.js --network test`

const {
  RegistryRolesEnum,
  getRandomSignedInt,
  getRandomUnsignedInt,
  encryptMessage,
  deriveKeyPairFromSignatureTruffle,
  getKeyGenMessage,
  computeVoteHash,
} = require("@uma/common");
const { moveToNextRound, moveToNextPhase } = require("../../utils/Voting.js");

const Registry = artifacts.require("Registry");
const Voting = artifacts.require("Voting");
const VotingInterfaceTesting = artifacts.require("VotingInterfaceTesting");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const VotingToken = artifacts.require("VotingToken");

async function run() {
  const voting = await VotingInterfaceTesting.at((await Voting.deployed()).address);
  const votingToken = await VotingToken.deployed();
  const identifierWhitelist = await IdentifierWhitelist.deployed();
  const registry = await Registry.deployed();

  const accounts = await web3.eth.getAccounts();
  const owner = accounts[0];
  const registeredContract = accounts[1];
  const voter = accounts[2];

  await voting.setInflationRate({ rawValue: web3.utils.toWei("0.01", "ether") });
  await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, owner);

  if (!(await registry.isContractRegistered(registeredContract))) {
    await registry.registerContract([], registeredContract, { from: owner });
  }

  const identifier = web3.utils.utf8ToHex("test-identifier");
  await identifierWhitelist.addSupportedIdentifier(identifier);

  // Allow owner to mint new tokens
  await votingToken.addMember("1", owner);

  // Transfer tokens to the voter such they they have enough to pass all votes on their own
  const ownerBalance = await votingToken.balanceOf(owner);
  await votingToken.transfer(voter, ownerBalance, { from: owner });

  // Pick a random time. Probabilistically, this won't request a duplicate time from a previous run.
  let time = Math.floor(Math.random() * (await voting.getCurrentTime()));

  // Define all three cases we want to check for
  let tests = ["batchCommit", "batchReveal", "retrieveRewards"];

  let results = {}; // Object to store maximum results achieved.

  console.log("Executing the following tests:", tests, "\nThis script can take a while to run.\n");

  for (let j = 0; j < tests.length; j++) {
    // Binary search parameters. search starts at 64 and will either half our double if it finds
    // it can fit that number within one block. Algorithm iterates until there is convergence
    let requestNum = 32;
    let converged = false;
    let lowestFailed = 0;
    let highestPassed = 0;

    console.log("Finding maximum batch size for", tests[j], "that can be run in one transaction.");
    while (!converged) {
      if (lowestFailed - highestPassed === 1) {
        console.log("*** Maximum tx per block reached for", tests[j], "as:", highestPassed, "***");
        converged = true;
        break;
      }
      console.log("testing size:", requestNum);
      try {
        switch (j) {
          case 0:
            await cycleCommit(voting, identifier, time, requestNum, registeredContract, voter, results);
            break;
          case 1:
            await cycleReveal(voting, identifier, time, requestNum, registeredContract, voter, results);
            break;
          case 2:
            await cycleClaim(voting, identifier, time, requestNum, registeredContract, voter, results);
            break;
          default:
            break;
        }
        highestPassed = requestNum;
        if (lowestFailed != 0) {
          requestNum = Math.floor((lowestFailed + highestPassed) / 2);
        } else {
          requestNum = requestNum * 2;
        }
      } catch (error) {
        console.log("Could not fit", requestNum, "into one transaction. Decreasing size.");
        lowestFailed = requestNum;
        requestNum = Math.floor((lowestFailed + highestPassed) / 2);
      }
      time = Math.floor(Math.random() * (await voting.getCurrentTime()));
    }
  }
  console.log("Done!");
  console.table(results);
}

const generatePriceRequests = async (requestNum, voting, identifier, time, registeredContract) => {
  for (var i = 0; i < requestNum; i++) {
    await voting.requestPrice(identifier, time + i, { from: registeredContract });
  }
};

// Test how many commits can be placed within one block. Initially request n number
// of price feeds then batch commit on them.
const cycleCommit = async (voting, identifier, time, requestNum, registeredContract, voter, results) => {
  // Generate prices up front for the test
  await generatePriceRequests(requestNum, voting, identifier, time, registeredContract);

  // Advance to commit phase
  await moveToNextRound(voting);
  const roundId = await voting.getCurrentRoundId();

  const salts = [];
  const price = getRandomSignedInt();
  const commitments = [];

  // Create the batch of commitments.
  for (var i = 0; i < requestNum; i++) {
    const salt = getRandomUnsignedInt();
    const hash = computeVoteHash({ price, salt, account: voter, time: time + i, roundId, identifier });
    salts[i] = salt;

    // Generate encrypted vote to store on chain.
    const vote = { price, salt };
    const { publicKey } = await deriveKeyPairFromSignatureTruffle(web3, getKeyGenMessage(roundId), voter);
    const encryptedVote = await encryptMessage(publicKey, JSON.stringify(vote));

    // Add encrypted vote to commitment.
    commitments.push({ identifier: identifier, time: time + i, hash: hash, encryptedVote: encryptedVote });
  }

  // Batch commit commitments generated. If this exceeds the gas limit will revert.
  const result = await voting.batchCommit(commitments, { from: voter });
  console.log("batchCommit used", result.receipt.gasUsed, "gas to fit", requestNum, "in one tx.");
  results["batchCommit"] = { number: requestNum, gasUsed: result.receipt.gasUsed };
};

// Test how many reveals can be placed within one block. The process for requesting and committing
// are done linearly (not batched) so that the test for revels is not impacted by this.
const cycleReveal = async (voting, identifier, time, requestNum, registeredContract, voter, results) => {
  await generatePriceRequests(requestNum, voting, identifier, time, registeredContract);

  await moveToNextRound(voting);
  const roundId = await voting.getCurrentRoundId();

  const salts = [];
  const price = getRandomSignedInt();

  // Generate Commitments. We will use single commit so no upper bound from the previous test
  for (let i = 0; i < requestNum; i++) {
    const salt = getRandomUnsignedInt();
    const hash = computeVoteHash({ price, salt, account: voter, time: time + i, roundId, identifier });
    await voting.commitVote(identifier, time + i, hash, { from: voter });
    salts[i] = salt;
  }

  // Advance to reveal phase
  await moveToNextPhase(voting);

  let reveals = [];
  for (var i = 0; i < requestNum; i++) {
    reveals.push({ identifier: identifier, time: time + i, price: price.toString(), salt: salts[i].toString() });
  }

  // Batch reveal. If this exceeds the gas limit will revert.
  const result = await voting.batchReveal(reveals, { from: voter });
  console.log("batchReveal used", result.receipt.gasUsed, "gas to fit", requestNum, "in one tx.");
  results["batchReveal"] = { number: requestNum, gasUsed: result.receipt.gasUsed };
};

// Test how many claims can be fit within one block. Generation of price requests, commits and
// reveals are all done linearly.
const cycleClaim = async (voting, identifier, time, requestNum, registeredContract, voter, results) => {
  await generatePriceRequests(requestNum, voting, identifier, time, registeredContract);

  await moveToNextRound(voting);
  let roundId = await voting.getCurrentRoundId();

  const salts = [];
  const price = getRandomSignedInt();

  for (let i = 0; i < requestNum; i++) {
    const salt = getRandomUnsignedInt();
    const hash = computeVoteHash({ price, salt, account: voter, time: time + i, roundId, identifier });
    await voting.commitVote(identifier, time + i, hash, { from: voter });
    salts[i] = salt;
  }

  // Advance to reveal phase
  await moveToNextPhase(voting);

  for (var i = 0; i < requestNum; i++) {
    await voting.revealVote(identifier, time + i, price, salts[i], { from: voter });
  }

  // Finally generate the batch rewards to retrieve
  roundId = await voting.getCurrentRoundId();

  await moveToNextRound(voting);

  let pendingRequests = [];
  for (let i = 0; i < requestNum; i++) {
    pendingRequests.push({ identifier: identifier, time: time + i });
  }

  // Batch request rewards. If exceeds will revert.
  const result = await voting.retrieveRewards(voter, roundId, pendingRequests, { from: voter });
  console.log("retrieveRewards used", result.receipt.gasUsed, "gas to fit", requestNum, "in one tx.");
  results["retrieveRewards"] = { number: requestNum, gasUsed: result.receipt.gasUsed };
};

module.exports = async function (cb) {
  try {
    await run();
  } catch (err) {
    console.log(err);
  }
  cb();
};
