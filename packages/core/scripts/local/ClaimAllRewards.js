// Usage: $(npm bin)/truffle exec ./scripts/ClaimAllRewards.js --round <round_id> --batcherAddress 0x82458d1C812D7c930Bb3229c9e159cbabD9AA8Cb --network mainnet_mnemonic

const Voting = artifacts.require("Voting");
const TransactionBatcher = artifacts.require("TransactionBatcher");

const argv = require("minimist")(process.argv.slice(), { string: ["round", "batcherAddress"] });

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
            console.log("Found Rewards for voter", voter);
            return [voter, priceRequests];
          }
        } catch (error) {
          return null;
        }
      })
    )
  ).filter(element => element !== null);

  const dataArray = retrievableRewards.map(([voter, priceRequests]) => {
    return voting.contract.methods.retrieveRewards(voter, argv.round, priceRequests).encodeABI();
  });

  const valuesArray = dataArray.map(() => "0");
  const targetArray = dataArray.map(() => voting.address);

  const transactionBatcher = await TransactionBatcher.at(argv.batcherAddress);
  const txn = transactionBatcher.contract.methods.batchSend(targetArray, valuesArray, dataArray);
  const account = (await web3.eth.getAccounts())[0];
  const gasEstimate = await txn.estimateGas({ from: account });

  if (gasEstimate > 9000000) {
    throw "The transaction requires too much gas. Will need to be split up.";
  }

  await transactionBatcher.batchSend(targetArray, valuesArray, dataArray);
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
