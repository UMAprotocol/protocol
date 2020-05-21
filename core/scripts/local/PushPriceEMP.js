// Push a price for latest mock oracle price request. To be used in testing.
const { toWei, fromWei, utf8ToHex, hexToUtf8 } = web3.utils;
const { interfaceName } = require("../../utils/Constants");

// Deployed contract ABI's and addresses we need to fetch.
const MockOracle = artifacts.require("MockOracle");
const Finder = artifacts.require("Finder");

const argv = require("minimist")(process.argv.slice(), { string: ["id", "price"] });

// Contracts we need to interact with.
let mockOracle;
let finder;

const pushPriceEMP = async callback => {
  try {
    finder = await Finder.deployed();
    mockOracle = await MockOracle.at(await finder.getImplementationAddress(utf8ToHex(interfaceName.Oracle)));
    const priceFeedIdentifier = utf8ToHex("ETH/BTC");
    const pendingRequests = await mockOracle.getPendingQueries();

    let priceRequestIndex = argv.id;
    if (!priceRequestIndex) {
      console.log('Optional price request "id" not specified, defaulting to index 0');
      priceRequestIndex = 0;
    }
    if (priceRequestIndex >= pendingRequests.length) {
      console.log(
        `Price request "id" is greater than count of pending requests, defaulting to highest index ${pendingRequests.length -
          1}`
      );
      priceRequestIndex = pendingRequests.length - 1;
    }
    // This might fail if there is more than 1 pending request.
    console.log(
      `MockOracle latest price request for ${hexToUtf8(pendingRequests[priceRequestIndex]["identifier"])} @ time ${
        pendingRequests[0].time
      }`
    );

    // Now, push a price to the oracle.
    // If the dispute price is lower than the liquidation price (1.2), then the dispute will succeed.
    let disputePrice;
    if (!argv.price) {
      console.log("Pushing default price of 1");
      disputePrice = toWei("1");
    } else {
      disputePrice = toWei(argv.price);
    }
    await mockOracle.pushPrice(priceFeedIdentifier, pendingRequests[0].time, disputePrice);
    console.log(`Pushed a price to the mock oracle: ${fromWei(disputePrice)}`);
  } catch (err) {
    console.error(err);
    callback(err);
    return;
  }
  callback();
};

module.exports = pushPriceEMP;
