const { RegistryRolesEnum } = require("../../../common/Enums.js");
const { getRandomSignedInt, getRandomUnsignedInt } = require("../../../common/Random.js");
const { moveToNextRound, moveToNextPhase } = require("../../utils/Voting.js");

const Registry = artifacts.require("Registry");
const Voting = artifacts.require("Voting");
const VotingToken = artifacts.require("VotingToken");

const numRounds = 2;
const numPriceRequests = 2;
const numVoters = 2;

const getVoter = (accounts, id) => {
  // Offset by 2, because owner == accounts[0] and registeredDerivative == accounts[1]
  return accounts[id + 2];
};

async function run() {
  console.group(`Test Case Setup => (Rounds: ${numRounds}, PriceRequests: ${numPriceRequests}, Voters: ${numVoters})`);
  const voting = await Voting.deployed();
  const votingToken = await VotingToken.deployed();
  const registry = await Registry.deployed();

  const accounts = await web3.eth.getAccounts();
  const owner = accounts[0];
  const registeredDerivative = accounts[1];

  await voting.setInflationRate({ rawValue: web3.utils.toWei("0.01", "ether") });
  await registry.addMember(RegistryRolesEnum.DERIVATIVE_CREATOR, owner);

  if (!(await registry.isDerivativeRegistered(registeredDerivative))) {
    await registry.registerDerivative([], registeredDerivative, { from: owner });
  }

  const identifier = web3.utils.utf8ToHex("test-identifier");
  await voting.addSupportedIdentifier(identifier);

  // Allow owner to mint new tokens
  await votingToken.addMember("1", owner);

  for (var i = 0; i < numVoters; i++) {
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

  for (var i = 0; i < numRounds; i++) {
    console.group(`\nRound ${i}`);
    await cycleRound(voting, votingToken, identifier, time, accounts);
    time += numPriceRequests;
    console.groupEnd();
  }

  for (var i = 0; i < numVoters; i++) {
    const voter = getVoter(accounts, i);
    console.log("balance", (await votingToken.balanceOf(voter)).toString());
  }
  console.log("total supply", (await votingToken.totalSupply()).toString());

  console.log("Done\n");
  console.groupEnd();
}

// Cycle through each round--consisting of a price request, commit, and reveal phase
const cycleRound = async (voting, votingToken, identifier, time, accounts
) => {
  /**
   * Estimating gas usage: requestPrice
   */
  console.group(`\nEstimating gas usage: requestPrice`);
  for (var i = 0; i < numPriceRequests; i++) {
    const result = await voting.requestPrice(identifier, time + i, { from: accounts[1] });
    const _gasUsed = result.receipt.gasUsed;
    console.log(`- Price Request #${i}: ${_gasUsed}`);
  }
  console.groupEnd();

  // Advance to commit phase
  await moveToNextRound(voting);

  const salts = {};
  const price = getRandomSignedInt();

  /**
   * Estimating gas usage: commitVote
   */
  let gasUsedCommitVote = 0;
  console.group(`\nEstimating gas usage: commitVote`);

  for (var i = 0; i < numPriceRequests; i++) {
    console.group(`Price request #${i}`);
    
    for (var j = 0; j < numVoters; j++) {
      const salt = getRandomUnsignedInt();
      const hash = web3.utils.soliditySha3(price, salt);

      const voter = getVoter(accounts, j);

      const result = await voting.commitVote(identifier, time + i, hash, { from: voter });
      const _gasUsed = result.receipt.gasUsed;
      console.log(`- Commit #${j}: ${_gasUsed}`);
      gasUsedCommitVote += _gasUsed;

      if (salts[i] == null) {
        salts[i] = {};
      }
      salts[i][j] = salt;
    }
    console.groupEnd();
  }
  console.log(`- total gas: ${gasUsedCommitVote}`)
  console.groupEnd();

  // Advance to reveal phase
  await moveToNextPhase(voting);

  /**
   * Estimating gas usage: revealVote
   */
  let gasUsedRevealVote = 0;
  console.group(`\nEstimating gas usage: revealVote`);

  for (var i = 0; i < numPriceRequests; i++) {
    console.group(`Price request #${i}`);

    for (var j = 0; j < numVoters; j++) {
      const voter = getVoter(accounts, j);

      const result = await voting.revealVote(identifier, time + i, price, salts[i][j], { from: voter });
      const _gasUsed = result.receipt.gasUsed;
      console.log(`- Reveal #${j}: ${_gasUsed}`);
      gasUsedRevealVote += _gasUsed;
    }
    console.groupEnd();
  }
  console.log(`- total gas: ${gasUsedRevealVote}`)
  console.groupEnd();
  
};

module.exports = async function(cb) {
  try {
    await run()
  } catch (err) {
    console.log(err);
  }

  cb();
};
