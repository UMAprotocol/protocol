const argv = require("minimist")(process.argv.slice(), { string: ["identifier", "price", "time"] });
const { interfaceName } = require("../utils/Constants.js");

const Finder = artifacts.require("Finder");
const ManualPriceFeed = artifacts.require("ManualPriceFeed");

async function run(account, identifier, priceAsString, time) {
  try {
    const identifierBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex(identifier));
    const price = web3.utils.toWei(priceAsString);

    const deployedFinder = await Finder.deployed();
    const priceFeed = await ManualPriceFeed.at(
      await deployedFinder.getImplementationAddress(web3.utils.utf8ToHex(interfaceName.PriceFeed))
    );

    await priceFeed.pushLatestPrice(identifierBytes, time, price, { from: account });
    console.log(`Published price for ${identifier} @ ${time}: ${priceAsString}`);
  } catch (e) {
    console.log("ERROR: " + e);
  }
}

const PublishTestPrice = async function(callback) {
  const account = (await web3.eth.getAccounts())[0];

  await run(account, argv.identifier, argv.price, argv.time);

  callback();
};

// Attach this function to the exported function
// in order to allow the script to be executed through both truffle and a test runner.
PublishTestPrice.run = run;
module.exports = PublishTestPrice;
