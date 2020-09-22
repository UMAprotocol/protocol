// Usage: $(npm bin)/truffle exec ./scripts/ClaimAllRewards.js --round <round_id> --network mainnet_mnemonic

const Voting = artifacts.require("Voting");

const argv = require("minimist")(process.argv.slice(), { string: ["round"] });

const { toBN, toWei } = web3.utils;

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

  const retrievableRewards = (
    await Promise.all(
      Object.entries(votersToPriceRequests).map(async ([voter, priceRequests]) => {
        try {
          const output = await voting.retrieveRewards.call(voter, argv.round, priceRequests);
          if (output.toString() === "0") {
            return null;
          } else if (toBN(output.toString()).gt(toBN(toWei("100000000")))) {
            // If the output is bigger than 100MM tokens, that means this is _really_ a revert.
            return null;
          } else {
            return [voter, priceRequests];
          }
        } catch (error) {
          return null;
        }
      })
    )
  ).filter(element => element !== null);

  retrievableRewards.map(([voter, priceRequests]) => {
    voter;
    priceRequests;
  });

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
