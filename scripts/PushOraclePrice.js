const CentralizedOracle = artifacts.require("CentralizedOracle");
const commandlineUtil = require("./CommandlineUtil");

async function run() {
  try {
    // Usage: truffle exec scripts/PushOraclePrice.js <CentralizedOracle address> <identifier> <time> <price>
    // where <time> is seconds since January 1st, 1970 00:00:00 UTC.
    if (process.argv.length < 8) {
      console.error("Not enough arguments. Must include <CentralizedOracle address>, <identifier>, <time> and <price>");
      return;
    }

    const oracleAddress = process.argv[4];
    if (!commandlineUtil.validateAddress(oracleAddress)) {
      console.error("CentralizedOracle's contract address missing. Exiting...");
      return;
    }

    const identifier = process.argv[5];
    const identifierInBytes = web3.utils.fromAscii(identifier);

    const timeInSeconds = parseInt(process.argv[6], 10);
    const timeInBN = web3.utils.toBN(timeInSeconds);
    const time = new Date(timeInSeconds * 10e2);

    const price = parseInt(process.argv[7], 10);
    const priceInBN = web3.utils.toBN(price);

    const oracle = await CentralizedOracle.at(oracleAddress);
    await oracle.pushPrice(identifierInBytes, timeInBN, priceInBN);
    console.log(`Resolved price for ${identifier} @ ${time}: ${price}`);
  } catch (err) {
    console.error(err);
    return;
  }
}

module.exports = async function(callback) {
  await run();
  callback();
};
