const { RegistryRolesEnum, getRandomSignedInt, getRandomUnsignedInt, computeVoteHash } = require("@uma/common");
const { moveToNextRound, moveToNextPhase } = require("../../utils/Voting.js");

const Registry = artifacts.require("Registry");
const Voting = artifacts.require("Voting");
const VotingInterfaceTesting = artifacts.require("VotingInterfaceTesting");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const VotingToken = artifacts.require("VotingToken");

const numRounds = 2;
const numPriceRequests = 2;
const numVoters = 2;

const getVoter = (accounts, id) => {
  // Offset by 2, because owner == accounts[0] and registeredContract == accounts[1]
  return accounts[id + 2];
};

async function run() {
  console.group(`Test Case Setup => (Rounds: ${numRounds}, PriceRequests: ${numPriceRequests}, Voters: ${numVoters})`);
  const voting = await VotingInterfaceTesting.at((await Voting.deployed()).address);
  const supportedIdentifiers = await IdentifierWhitelist.deployed();
  const votingToken = await VotingToken.deployed();
  const registry = await Registry.deployed();

  const accounts = await web3.eth.getAccounts();
  const owner = accounts[0];
  const registeredContract = accounts[1];

  await voting.setInflationRate({ rawValue: web3.utils.toWei("0.01", "ether") });
  await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, owner);

  if (!(await registry.isContractRegistered(registeredContract))) {
    await registry.registerContract([], registeredContract, { from: owner });
  }

  const identifier = web3.utils.utf8ToHex("test-identifier");
  await supportedIdentifiers.addSupportedIdentifier(identifier);

  // Allow owner to mint new tokens
  await votingToken.addMember("1", owner);

  for (let i = 0; i < numVoters; i++) {
    const voter = getVoter(accounts, i);
    const balance = await votingToken.balanceOf(voter);
    const floorBalance = web3.utils.toBN(web3.utils.toWei("100", "ether"));
    if (balance.lt(floorBalance)) {
      console.log("Minting tokens for", voter);
      await votingToken.mint(voter, web3.utils.toWei("100", "ether"));
    }
  }

  const now = await voting.getCurrentTime();
  const max = now - numPriceRequests * numRounds;
  // Pick a random time. Probabilistically, this won't request a duplicate time from a previous run.
  let time = Math.floor(Math.random() * max);

  console.log("Voting tokens total supply:", (await votingToken.totalSupply()).toString());

  for (let i = 0; i < numRounds; i++) {
    console.group(`\n*** Round ${i} ***`);
    await cycleRound(voting, votingToken, identifier, time, accounts);
    time += numPriceRequests;
    console.groupEnd();
  }

  console.group("\nVoter token balances post-test:");
  for (let i = 0; i < numVoters; i++) {
    const voter = getVoter(accounts, i);
    const balance = await votingToken.balanceOf(voter);
    console.log(`- Voter #${i}: ${balance.toString()}`);
  }
  console.groupEnd();
  console.log("Voting tokens total supply", (await votingToken.totalSupply()).toString());

  console.groupEnd();
}

// Cycle through each round--consisting of a price request, commit, and reveal phase
const cycleRound = async (voting, votingToken, identifier, time, accounts) => {
  // Estimating gas usage: requestPrice.
  let gasUsedPriceRequest = 0;
  console.group("\nEstimating gas usage: requestPrice");

  for (let i = 0; i < numPriceRequests; i++) {
    const result = await voting.requestPrice(identifier, time + i, { from: accounts[1] });
    const gasUsed = result.receipt.gasUsed;
    console.log(`Price Request #${i}: ${gasUsed}`);
    gasUsedPriceRequest += gasUsed;
  }
  console.log(`Total gas: ${gasUsedPriceRequest}`);
  console.groupEnd();

  // Advance to commit phase
  await moveToNextRound(voting);
  const roundId = await voting.getCurrentRoundId();

  const salts = {};
  const price = getRandomSignedInt();

  // Estimating gas usage: commitVote
  let gasUsedCommitVote = 0;
  console.group("\nEstimating gas usage: commitVote");

  for (let i = 0; i < numPriceRequests; i++) {
    console.group(`Price request #${i}`);

    for (let j = 0; j < numVoters; j++) {
      const salt = getRandomUnsignedInt();
      const voter = getVoter(accounts, j);
      const hash = computeVoteHash({ price, salt, account: voter, time: time + i, roundId, identifier });

      const result = await voting.commitVote(identifier, time + i, hash, { from: voter });
      const gasUsed = result.receipt.gasUsed;
      console.log(`- Commit #${j}: ${gasUsed}`);
      gasUsedCommitVote += gasUsed;

      if (salts[i] == null) {
        salts[i] = {};
      }
      salts[i][j] = salt;
    }
    console.groupEnd();
  }
  console.log(`Total gas: ${gasUsedCommitVote}`);
  console.groupEnd();

  // Advance to reveal phase
  await moveToNextPhase(voting);

  // Estimating gas usage: revealVote
  let gasUsedRevealVote = 0;
  console.group("\nEstimating gas usage: revealVote");

  for (let i = 0; i < numPriceRequests; i++) {
    console.group(`Price request #${i}`);

    for (let j = 0; j < numVoters; j++) {
      const voter = getVoter(accounts, j);

      const result = await voting.revealVote(identifier, time + i, price, salts[i][j], { from: voter });
      const gasUsed = result.receipt.gasUsed;
      console.log(`- Reveal #${j}: ${gasUsed}`);
      gasUsedRevealVote += gasUsed;
    }
    console.groupEnd();
  }
  console.log(`Total gas: ${gasUsedRevealVote}`);
  console.groupEnd();
};

module.exports = async function (cb) {
  try {
    await run();
  } catch (err) {
    console.log(err);
  }

  cb();
};
