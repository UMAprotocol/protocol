const CentralizedOracle = artifacts.require("CentralizedOracle");
const commandlineUtil = require("./CommandlineUtil");

const argv = require("minimist")(process.argv.slice(), { string: ["identifier"] });

async function run(identifier, timeInSeconds, price) {
  try {
    const identifierInBytes = web3.utils.fromAscii(identifier);

    const timeInBN = web3.utils.toBN(timeInSeconds);
    const time = new Date(timeInSeconds * 10e2);

    const priceInBN = web3.utils.toBN(price);

    const oracle = await CentralizedOracle.deployed();
    await oracle.pushPrice(identifierInBytes, timeInBN, priceInBN);
    console.log(`Resolved price for ${identifier} @ ${time}: ${price}`);
  } catch (err) {
    console.error(err);
    return;
  }
}

const runPushOraclePrice = async function(callback) {
  // Usage: truffle exec scripts/PushOraclePrice.js --identifier <identifier> --time <time> --price <price> --keys <oracle key> --network <network>
  // where <time> is seconds since epoch.

  await run(argv.identifier, argv.time, argv.price);
  callback();
};

// Attach this function to the exported function
// in order to allow the script to be executed through both truffle and a test runner.
runPushOraclePrice.run = run;
module.exports = runPushOraclePrice;
