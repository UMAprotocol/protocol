const { RegistryRolesEnum } = require("../../utils/Enums.js");
const Random = require("../../utils/Random.js");
const getRandomSignedInt = () => Random.getRandomSignedInt(web3);
const getRandomUnsignedInt = () => Random.getRandomUnsignedInt(web3);

const Registry = artifacts.require("Registry");
const Voting = artifacts.require("Voting");
const VotingToken = artifacts.require("VotingToken");

const COMMIT_PHASE = "0";
const secondsPerDay = web3.utils.toBN(86400);

const moveToNextRound = async voting => {
  const phase = await voting.getVotePhase();
  const currentTime = await voting.getCurrentTime();
  let timeIncrement;
  if (phase.toString() === COMMIT_PHASE) {
    timeIncrement = secondsPerDay.muln(2);
  } else {
    timeIncrement = secondsPerDay;
  }

  await voting.setCurrentTime(currentTime.add(timeIncrement));
};

const moveToNextPhase = async voting => {
  const currentTime = await voting.getCurrentTime();
  await voting.setCurrentTime(currentTime.add(secondsPerDay));
};

const getVoter = async (accounts, id) => {
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

  await voting.setInflationRate({ value: web3.utils.toWei("0.01", "ether") });
  await registry.addMember(RegistryRolesEnum.DERIVATIVE_CREATOR, owner);

  if (!await registry.isDerivativeRegistered(registeredDerivative)) {
    await registry.registerDerivative([], registeredDerivative, { from: owner });
  }

  const identifier = web3.utils.utf8ToHex("test-identifier");
  await voting.addSupportedIdentifier(identifier);

  // Allow owner to mint new tokens
  await votingToken.addMember("1", owner);

  for (var i = 0; i < 5; i++) {
    const voter = await getVoter(accounts, i);
    if ((await votingToken.balanceOf(voter)) < web3.utils.toWei("100", "ether")) {
      console.log("Minting tokens for", voter);
      await votingToken.mint(voter, web3.utils.toWei("100", "ether"));
    }
  }

  const now = await voting.getCurrentTime();
  const max = now - 50;
  // Pick a random time. Probabilistically, this won't request a duplicate time from a previous run.
  let time = Math.floor(Math.random() * max);

  console.log("total supply", (await votingToken.totalSupply()).toString());

  for (var i = 0; i < 5; i++) {
    console.log("Round", i);
    // Makes 5 price requests that are resolved by 5 voters
    await cycleRound(voting, votingToken, identifier, time, accounts);
    time += 5;
  }

  for (var i = 0; i < 5; i++) {
    const voter = await getVoter(accounts, i);
    console.log("balance", (await votingToken.balanceOf(voter)).toString());
  }
  console.log("total supply", (await votingToken.totalSupply()).toString());

  console.log("Done");
}

const cycleRound = async (voting, votingToken, identifier, time, accounts) => {
  for (var i = 0; i < 5; i++) {
    console.log("requestPrice", await voting.requestPrice.estimateGas(identifier, time + i, { from: accounts[1] }));
    await voting.requestPrice(identifier, time + i, { from: accounts[1] });
  }

  await moveToNextRound(voting);

  const salts = {};
  const price = getRandomSignedInt();
  for (var i = 0; i < 5; i++) {
    for (var j = 0; j < 5; j++) {
      const salt = getRandomUnsignedInt();
      const hash = web3.utils.soliditySha3(price, salt);

      const voter = await getVoter(accounts, j);

      console.log("commit", await voting.commitVote.estimateGas(identifier, time + i, hash, { from: voter }));
      await voting.commitVote(identifier, time + i, hash, { from: voter });

      if (salts[i] == null) {
        salts[i] = {};
      }
      salts[i][j] = salt;
    }
  }

  await moveToNextPhase(voting);

  for (var i = 0; i < 5; i++ ) {
    for (var j = 0; j < 5; j++) {
      const voter = await getVoter(accounts, j);

      console.log("reveal", await voting.revealVote.estimateGas(identifier, time + i, price, salts[i][j], { from: voter }));
      await voting.revealVote(identifier, time + i, price, salts[i][j], { from: voter });
    }
  }
}

module.exports = async function(cb) {
  try {
    await run();
  } catch(err) {
    console.log(err);
  }

  cb();
};
