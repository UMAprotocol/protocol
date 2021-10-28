// Usage: From protocol/, run `yarn truffle exec ./packages/core/scripts/local/HistoricalPriceRequests.js --network mainnet_mnemonic`
const VotingInterfaceTesting = artifacts.require("VotingInterfaceTesting");
const Voting = artifacts.require("Voting");
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const Governor = artifacts.require("Governor");
const { hexToUtf8 } = web3.utils;
const { getTransactionReceipt } = web3.eth;

const { isAdminRequest } = require("@uma/common");
// This script fetches and classifies all historical DVM price requests.
async function run() {
  const votingLegacy = await Voting.at("0x9921810C710E7c3f7A7C6831e30929f19537a545");
  const voting = await VotingInterfaceTesting.at((await Voting.deployed()).address);
  const governor = await Governor.deployed();

  // There have been 2 DVM's deployed on Mainnet to receive price requests so we need to query events from both.
  let priceRequests = await voting.contract.getPastEvents("PriceRequestAdded", { fromBlock: 0, toBlock: "latest" });
  const legacyPriceRequests = await votingLegacy.contract.getPastEvents("PriceRequestAdded", {
    fromBlock: 0,
    toBlock: "latest",
  });

  // Make sure price requests have resolved.
  let hasResolvedPromises = [];
  const hasPrice = (votingContract, req) => {
    return votingContract.hasPrice.call(req.returnValues.identifier, req.returnValues.time, { from: governor.address });
  };
  for (let i in priceRequests) {
    const req = priceRequests[i];
    hasResolvedPromises.push(
      new Promise((resolve) => {
        hasPrice(voting, req).then((hasPrice) => {
          resolve({ hasPrice, req });
        });
      })
    );
  }
  for (let i in legacyPriceRequests) {
    const req = legacyPriceRequests[i];
    hasResolvedPromises.push(
      new Promise((resolve) => {
        hasPrice(votingLegacy, req).then((hasPrice) => {
          resolve({ hasPrice, req });
        });
      })
    );
  }
  const resolvedReqs = (await Promise.all(hasResolvedPromises)).filter((req) => {
    return req.hasPrice;
  });
  console.log(
    `There are currently ${hasResolvedPromises.length - resolvedReqs.length} unresolved non-admin price requests.`
  );

  // Get all non admin votes.
  const nonAdminReqs = resolvedReqs.filter((req) => {
    return !isAdminRequest(hexToUtf8(req.req.returnValues.identifier));
  });

  // To determine if a price request was a non-expiry price request, we can check if a ContractExpired
  // event was emitted in the same block # as the PriceRequestAdded event.
  const getEventsPromises = nonAdminReqs.map(async (request) => {
    const receipt = await getTransactionReceipt(request.req.transactionHash);
    const emp = await ExpiringMultiParty.at(receipt.to);
    return await emp.contract.getPastEvents("ContractExpired", {
      fromBlock: receipt.blockNumber,
      toBlock: receipt.blockNumber,
      to: emp.address,
    });
  });

  // If no ContractExpired events were emitted, then we can assume it was a dispute that triggered the price request.
  const nonExpiryReqs = (await Promise.all(getEventsPromises)).filter((req) => {
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
