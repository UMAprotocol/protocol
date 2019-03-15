const argv = require("minimist")(process.argv.slice(), { string: ["identifier", "price"] });

const ManualPriceFeed = artifacts.require("ManualPriceFeed");

const PublishTestPrice = async function(callback) {
  try {
    const accounts = await web3.eth.getAccounts();
    const deployer = accounts[0];

    const identifierBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex(argv.identifier));
    const newPrice = web3.utils.toWei(argv.price);
    const newTime = argv.time;

    const priceFeed = await ManualPriceFeed.deployed();

    const { publishTime } = await priceFeed.latestPrice(identifierBytes);

    if (publishTime > newTime) {
      throw new Error(`New time ${newTime} older than the previous time ${publishTime}`);
    }

    await priceFeed.setCurrentTime(newTime, { from: deployer });
    await priceFeed.pushLatestPrice(identifierBytes, newTime, newPrice, { from: deployer });
  } catch (e) {
    console.log("ERROR: " + e);
  }

  callback();
};

module.exports = PublishTestPrice;
