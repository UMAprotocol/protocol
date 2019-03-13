const CentralizedOracle = artifacts.require("CentralizedOracle");
const commandlineUtil = require("./CommandlineUtil");

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
  // Usage: truffle exec scripts/PushOraclePrice.js <identifier> <time> <price> --network <network>
  // where <time> is seconds since January 1st, 1970 00:00:00 UTC.
  if (process.argv.length < 7) {
    console.error("Not enough arguments. Must include <identifier>, <time> and <price>");
    return;
  }

  const identifier = process.argv[4];
  const timeInSeconds = parseInt(process.argv[5], 10);
  const price = parseInt(process.argv[6], 10);

  await run(identifier, timeInSeconds, price);
  callback();
};

// Attach this function to the exported function
// in order to allow the script to be executed through both truffle and a test runner.
runPushOraclePrice.run = run;
module.exports = runPushOraclePrice;
