const CentralizedOracle = artifacts.require("CentralizedOracle");
const commandlineUtil = require("./CommandlineUtil");

async function run(oracleAddress, identifier, timeInSeconds, price) {
  try {
    const identifierInBytes = web3.utils.fromAscii(identifier);

    const timeInBN = web3.utils.toBN(timeInSeconds);
    const time = new Date(timeInSeconds * 10e2);

    const priceInBN = web3.utils.toBN(price);

    const oracle = await CentralizedOracle.at(oracleAddress);
    await oracle.pushPrice(identifierInBytes, timeInBN, priceInBN);
    console.log(`Resolved price for ${identifier} @ ${time}: ${price}`);
  } catch (err) {
    console.error(err);
    return;
  }
}

const runPushOraclePrice = async function(callback) {
  // Usage: truffle exec scripts/PushOraclePrice.js <CentralizedOracle address> <identifier> <time> <price> --network <network>
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
  const timeInSeconds = parseInt(process.argv[6], 10);
  const price = parseInt(process.argv[7], 10);

  await run(oracleAddress, identifier, timeInSeconds, price);
  callback();
};

runPushOraclePrice.run = run;

module.exports = runPushOraclePrice;
