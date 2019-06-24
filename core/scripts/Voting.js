const Voting = artifacts.require("Voting");
const { VotePhasesEnum } = require("../utils/Enums");
const fetch = require("node-fetch");

function stripApiKey(str, key) {
  return str.replace(key, "{redacted}");
}

// Gets JSON from a URL or throws.
const getJson = async url => {
  const response = await fetch(url);
  const json = await response.json();
  if (!json) {
    throw `Query [${url}] failed to get JSON`;
  }
  return json;
};

async function fetchCryptoComparePrice(request) {
  const identifier = request.identifier;
  const time = request.time;

  // Temporary price feed until we sort historical data.
  const url = `https://min-api.cryptocompare.com/data/histohour?fsym=${identifier.first}&tsym=${identifier.second}&limit=3`;
  console.log(`Querying with [${url}]`);
  const jsonOutput = await getJson(url);
  console.log(`Response [${JSON.stringify(jsonOutput)}]`);

  if (jsonOutput.Type != "100") {
    throw "Request failed";
  }

  if (jsonOutput.Data == null) {
    throw "Unexpected number of results in json response";
  }

  const price = jsonOutput.Data[0].open;
  if (!price) {
    throw "Failed to get valid price out of JSON response";
  }

  const tradeTime = jsonOutput.Data[0].time;
  console.log(`Retrieved quote [${price}] at [${tradeTime}] for asset [${identifier.first}${identifier.second}]`);

  return { price };
}

async function fetchPrice(request) {
  return web3.utils.toWei("1.5");
}

// TODO(#493): Implement persistance.
class VotingSystem {
  constructor(voting, persistence) {
    this.voting = voting;
    this.persistence = persistence;
  }

  async runCommit(request, roundId) {
    const persistedVote = this.persistence[{ request, roundId }];
    // If the vote has already been persisted and committed, we don't need to recommit.
    if (persistedVote) {
      return;
    }
    const fetchedPrice = await fetchPrice(request);
    const salt = web3.utils.toBN(web3.utils.randomHex(32));

    this.persistence[{ request, roundId }] = { price: fetchedPrice, salt: salt };
    const hash = web3.utils.soliditySha3(fetchedPrice, salt);
    await this.voting.commitVote(request.identifier, request.time, hash);
  }

  async runReveal(request, roundId) {
    const persistedVote = this.persistence[{ request, roundId }];
    // If no vote was persisted and committed, then we can't reveal.
    if (persistedVote) {
      await this.voting.revealVote(request.identifier, request.time, persistedVote.price, persistedVote.salt);
      delete this.persistence[{ request, roundId }];
    }
  }

  async runIteration() {
    const phase = await this.voting.getVotePhase();
    const roundId = await this.voting.getCurrentRoundId();
    const pendingRequests = await this.voting.getPendingRequests();
    for (const request of pendingRequests) {
      if (phase == VotePhasesEnum.COMMIT) {
        await this.runCommit(request, roundId);
      } else {
        await this.runReveal(request, roundId);
      }
    }
  }
}

async function runVoting() {
  try {
    const voting = await Voting.deployed();
    const votingSystem = new VotingSystem(voting, {});
    await votingSystem.runIteration();
  } catch (error) {
    console.log(error);
  }
}

run = async function(callback) {
  var request = { identifier: { first: "BTC", second: "USD" }, time: "1560762000" };
  await fetchPrice(request);
  await fetchCryptoComparePrice(request);
  callback();
};
run.VotingSystem = VotingSystem;
module.exports = run;
