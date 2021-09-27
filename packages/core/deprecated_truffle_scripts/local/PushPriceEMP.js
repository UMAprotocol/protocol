/**
 * @notice Push a price for a mock oracle price request. User can specify which pending price request to push a price
 * for and what price to use. Note that the more recent the price request the higher the index. It is possible
 * `MockOracle.getPendingQueries` returns already-resolved price requests, so this script will inform you if
 * the price has been resolved.
 *
 * Example: $(npm bin)/truffle exec ./scripts/local/PushPriceEMP.js --network test --id 1 --price 1.2
 */
const { toWei, fromWei, utf8ToHex, hexToUtf8 } = web3.utils;
const { interfaceName } = require("@uma/common");

// Deployed contract ABI's and addresses we need to fetch.
const MockOracle = artifacts.require("MockOracle");
const Finder = artifacts.require("Finder");

const argv = require("minimist")(process.argv.slice(), { string: ["id", "price"] });

// Contracts we need to interact with.
let mockOracle;
let finder;

const pushPriceEMP = async (callback) => {
  try {
    // Get MockOracle in Finder.
    finder = await Finder.deployed();
    mockOracle = await MockOracle.at(await finder.getImplementationAddress(utf8ToHex(interfaceName.Oracle)));
    const priceFeedIdentifier = utf8ToHex("ETH/BTC");
    const pendingRequests = await mockOracle.getPendingQueries();
    console.log(`There are ${pendingRequests.length} pending price requests:`, pendingRequests);

    // Determine which pending price request to push a price for.
    let priceRequestIndex = argv.id;
    if (!priceRequestIndex) {
      console.log('Optional price request "id" not specified, defaulting to index 0');
      priceRequestIndex = 0;
    }
    if (priceRequestIndex >= pendingRequests.length) {
      console.log(
        `Price request "id" is greater than count of pending requests, defaulting to highest index ${
          pendingRequests.length - 1
        }`
      );
      priceRequestIndex = pendingRequests.length - 1;
    }
    console.log(
      `Attempting to push a price for ${hexToUtf8(pendingRequests[priceRequestIndex]["identifier"])} @ time ${
        pendingRequests[priceRequestIndex].time
      }`
    );

    // Check of oracle has already resolved a price
    if (await mockOracle.hasPrice(priceFeedIdentifier, pendingRequests[priceRequestIndex].time)) {
      const resolvedPrice = await mockOracle.getPrice(priceFeedIdentifier, pendingRequests[priceRequestIndex].time);
      console.log(`Mock oracle already has a price: ${fromWei(resolvedPrice)}`);
      return;
    } else {
      // Now, push the price to the oracle.
      // FYI: If the resolved price is lower than the liquidation price, then the dispute will succeed.
      let disputePrice;
      if (!argv.price) {
        console.log("Pushing default price of 1");
        disputePrice = toWei("1");
      } else {
        console.log(`Pushing price of ${argv.price}`);
        disputePrice = toWei(argv.price);
      }

      await mockOracle.pushPrice(priceFeedIdentifier, pendingRequests[priceRequestIndex].time, disputePrice);
      console.log(`Pushed a new price to the mock oracle: ${fromWei(disputePrice)}`);
    }
  } catch (err) {
    console.error(err);
    callback(err);
    return;
  }
  callback();
};

module.exports = pushPriceEMP;
