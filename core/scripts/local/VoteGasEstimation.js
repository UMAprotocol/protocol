const { RegistryRolesEnum, VotePhasesEnum } = require("../../utils/Enums.js");
const { getRandomSignedInt, getRandomUnsignedInt } = require("../../utils/Random.js");
const { moveToNextRound, moveToNextPhase } = require("../../utils/Voting.js");

const Registry = artifacts.require("Registry");
const Voting = artifacts.require("Voting");
const VotingToken = artifacts.require("VotingToken");

const numPriceRequests = 5;
const numVoters = 5;
const numRounds = 5;

const getVoter = (accounts, id) => {
  // Offset by 2, because owner == accounts[0] and registeredDerivative == accounts[1]
  return accounts[id + 2];
};

async function run() {
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

  console.log("total supply", (await votingToken.totalSupply()).toString());

  for (var i = 0; i < numRounds; i++) {
    console.log("Round", i);
    await cycleRound(voting, votingToken, identifier, time, accounts);
    time += numPriceRequests;
  }

  for (var i = 0; i < numVoters; i++) {
    const voter = getVoter(accounts, i);
    console.log("balance", (await votingToken.balanceOf(voter)).toString());
  }
  console.log("total supply", (await votingToken.totalSupply()).toString());

  console.log("Done");
}

const cycleRound = async (voting, votingToken, identifier, time, accounts) => {
  for (var i = 0; i < numPriceRequests; i++) {
    const result = await voting.requestPrice(identifier, time + i, { from: accounts[1] });
    console.log("requestPrice", result.receipt.gasUsed);
  }

  await moveToNextRound(voting);

  const salts = {};
  const price = getRandomSignedInt();
  for (var i = 0; i < numPriceRequests; i++) {
    for (var j = 0; j < numVoters; j++) {
      const salt = getRandomUnsignedInt();
      const hash = web3.utils.soliditySha3(price, salt);

      const voter = getVoter(accounts, j);

      const result = await voting.commitVote(identifier, time + i, hash, { from: voter });
      console.log("commitVote", result.receipt.gasUsed);

      if (salts[i] == null) {
        salts[i] = {};
      }
      salts[i][j] = salt;
    }
  }

  await moveToNextPhase(voting);

  for (var i = 0; i < numPriceRequests; i++) {
    for (var j = 0; j < numVoters; j++) {
      const voter = getVoter(accounts, j);

      const result = await voting.revealVote(identifier, time + i, price, salts[i][j], { from: voter });
      console.log("revealVote", result.receipt.gasUsed);
    }
  }
};

module.exports = async function(cb) {
  try {
    await run();
  } catch (err) {
    console.log(err);
  }

  cb();
};
