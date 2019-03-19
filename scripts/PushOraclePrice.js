const CentralizedOracle = artifacts.require("CentralizedOracle");
const commandlineUtil = require("./CommandlineUtil");

const argv = require("minimist")(process.argv.slice(), { string: ["identifier", "price"] });

// priceAsString is formatted as a string, not a Number,
// because they must be a string when converting to wei.
async function run(identifier, timeInSeconds, priceAsString) {
  try {
    const identifierInBytes = web3.utils.fromAscii(identifier);

    const timeInBN = web3.utils.toBN(timeInSeconds);
    const time = new Date(timeInSeconds * 10e2);

    const priceInBN = web3.utils.toBN(web3.utils.toWei(priceAsString));

    const oracle = await CentralizedOracle.deployed();
    await oracle.pushPrice(identifierInBytes, timeInBN, priceInBN);
    console.log(`Resolved price for ${identifier} @ ${time}: ${priceAsString}`);
  } catch (err) {
    console.error(err);
    return;
  }
}

const runPushOraclePrice = async function(callback) {
  // Usage: truffle exec scripts/PushOraclePrice.js --identifier <identifier> --time <time> --price <price> --keys <oracle key> --network <network>
  // where <time> is seconds since epoch
  // and <price> is in ether (i.e. 10^18 wei)
  await run(argv.identifier, argv.time, argv.price);
  callback();
};

// Attach this function to the exported function
// in order to allow the script to be executed through both truffle and a test runner.
runPushOraclePrice.run = run;
module.exports = runPushOraclePrice;
