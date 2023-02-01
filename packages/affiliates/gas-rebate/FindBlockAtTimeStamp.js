// This script calculates the block number closet to a given timestamp.
// Script can be run as: node ./liquidity-mining/FindBlockAtTimeStamp.js --dateTime="2020-05-05 00:00" --network mainnet_mnemonic

const moment = require("moment");
const argv = require("minimist")(process.argv.slice(), { string: ["dateTime"] });
const { getWeb3, findBlockNumberAtTimestamp } = require("@uma/common");
const web3 = getWeb3();

const FindBlockAtTimeStamp = async (callback) => {
  try {
    const dateTime = moment.utc(argv.dateTime, "YYYY-MM-DD  HH:mm Z");
    if (!dateTime.isValid()) {
      throw new Error("Missing or invalid parameter! Provide `dateTime` must be strings formatted `YYYY-MM-DD HH:mm`");
    }
    console.log(`⏱  Finding closest block to ${argv.dateTime}. Note time is interpreted as UTC time.`);
    // Get the closet block number to the dateTime provided.
    const { blockNumber, error } = await findBlockNumberAtTimestamp(web3, dateTime.unix());
    console.log(`👀 Closest block to ${argv.dateTime} is ${blockNumber} with an error of ${error} seconds.`);
  } catch (err) {
    console.error(err);
    callback(err);
    return;
  }
  callback();
};

function nodeCallback(err) {
  if (err) {
    console.error(err);
    process.exit(1);
  } else process.exit(0);
}

// If called directly by node, execute the Poll Function. This lets the script be run as a node process.
if (require.main === module) {
  FindBlockAtTimeStamp(nodeCallback)
    .then(() => {})
    .catch(nodeCallback);
}

module.exports = FindBlockAtTimeStamp;
