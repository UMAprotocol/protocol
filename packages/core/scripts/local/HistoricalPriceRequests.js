// Usage: From protocol/, run `yarn truffle exec ./packages/core/scripts/local/HistoricalPriceRequests.js --network mainnet_mnemonic`
const Voting = artifacts.require("Voting");
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const { hexToUtf8 } = web3.utils;
const { getTransactionReceipt } = web3.eth;

const { isAdminRequest } = require("@uma/common");
// This script fetches and classifies all historical DVM price requests.
async function run() {
  const votingLegacy = await Voting.at("0x9921810C710E7c3f7A7C6831e30929f19537a545");
  const voting = await Voting.deployed();

  let priceRequests = await voting.contract.getPastEvents("PriceRequestAdded", {
    fromBlock: 0,
    toBlock: "latest"
  });
  const legacyPriceRequests = await votingLegacy.contract.getPastEvents("PriceRequestAdded", {
    fromBlock: 0,
    toBlock: "latest"
  });
  priceRequests = priceRequests.concat(legacyPriceRequests);

  // Get all non admin votes.
  const nonAdminReqs = priceRequests.filter(req => {
    return !isAdminRequest(hexToUtf8(req.returnValues.identifier));
  });

  // To determine if a price request was a non-expiry price request, we can check if a ContractExpired
  // event was emitted in the same block # as the PriceRequestAdded event.
  let getEventsPromises = [];
  for (let i in nonAdminReqs) {
    const promise = new Promise(resolve => {
      // To trigger a price request, some accounts called a financial contract that triggered a price request. So
      // we'll grab the contract that was called.
      getTransactionReceipt(nonAdminReqs[i].transactionHash).then(txn => {
        const empAddress = txn.to;
        ExpiringMultiParty.at(empAddress).then(emp => {
          emp.contract
            .getPastEvents("ContractExpired", {
              fromBlock: txn.blockNumber,
              toBlock: txn.blockNumber,
              to: empAddress
            })
            .then(events => {
              resolve(events);
            });
        });
      });
    });
    getEventsPromises.push(promise);
  }

  // If no ContractExpired events were emitted, then we can assume it was a dispute that triggered the price request.
  const nonExpiryReqs = (await Promise.all(getEventsPromises)).filter(req => {
    return req.length === 0;
  });

  console.log(`There have been ${nonExpiryReqs.length} non-expiry price requests.`);
}

async function wrapper(callback) {
  try {
    await run();
  } catch (e) {
    // Forces the script to return a nonzero error code so failure can be detected in bash.
    callback(e);
    return;
  }

  callback();
}

module.exports = wrapper;
