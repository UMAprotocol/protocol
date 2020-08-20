// Usage: $(npm bin)/truffle exec ./scripts/ClaimAllRewards.js --round <round_id> --network mainnet_mnemonic

const Voting = artifacts.require("Voting");

const argv = require("minimist")(process.argv.slice(), { string: ["round"] });

// This script claims all voter's rewards for the round provided.
async function claimRewards() {
  const voting = await Voting.deployed();

  const events = await voting.contract.getPastEvents("VoteRevealed", {
    filter: { roundId: argv.round },
    fromBlock: 0,
    toBlock: "latest"
  });

  const votersToPriceRequests = {};
  for (const event of events) {
    const voter = event.returnValues.voter;
    const newPriceRequest = { identifier: event.returnValues.identifier, time: event.returnValues.time };
    if (votersToPriceRequests[voter]) {
      votersToPriceRequests[voter].push(newPriceRequest);
    } else {
      votersToPriceRequests[voter] = [newPriceRequest];
    }
  }

  for (const [voter, priceRequests] of Object.entries(votersToPriceRequests)) {
    try {
      await voting.retrieveRewards.call(voter, argv.round, priceRequests);
    } catch (err) {
      console.log("Could not reveal for voter", voter);
      console.log(err);
      continue;
    }

    await voting.retrieveRewards(voter, argv.round, priceRequests);
  }
}

async function wrapper(callback) {
  try {
    await claimRewards(argv.multisig);
  } catch (e) {
    // Forces the script to return a nonzero error code so failure can be detected in bash.
    callback(e);
    return;
  }

  callback();
}

module.exports = wrapper;
