// This script calculates the block number closet to a given timestamp.
// Script can be run as: truffle exec ./scripts/liquidity-mining/FindBlockAtTimeStamp.js --dateTime="2020-05-05 00:00"

const moment = require("moment");
const argv = require("minimist")(process.argv.slice(), {
  string: ["dateTime"]
});
const Web3 = require("web3");
const web3 = new Web3(new Web3.providers.HttpProvider(process.env.CUSTOM_NODE_URL));

const FindBlockAtTimeStamp = async callback => {
  try {
    const dateTime = moment.utc(argv.dateTime, "YYYY-MM-DD  HH:mm Z");
    if (!dateTime.isValid()) {
      throw new Error("Missing or invalid parameter! Provide `dateTime` must be strings formatted `YYYY-MM-DD  HH:mm`");
    }
    console.log(`⏱  Finding closest block to ${argv.dateTime}. Note time is interpreted as UTC time.`);
    // Get the closet block number to the dateTime provided.
    const { blockNumber, error } = await _findBlockNumberAtTimestamp(web3, dateTime.unix());
    console.log(`👀 Closest block to ${argv.dateTime} is ${blockNumber} with an error of ${error} seconds`);
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

async function _findBlockNumberAtTimestamp(web3, targetTimestamp, higherLimitMax = 15, lowerLimitMax = 15) {
  const higherLimitStamp = targetTimestamp + higherLimitMax;
  const lowerLimitStamp = targetTimestamp - lowerLimitMax;
  // Decreasing average block size will decrease precision and also decrease the amount of
  // requests made in order to find the closest block.
  let averageBlockTime = 15;

  // get current block number
  const currentBlockNumber = await web3.eth.getBlockNumber();
  let block = await web3.eth.getBlock(currentBlockNumber);
  let blockNumber = currentBlockNumber;

  while (block.timestamp > targetTimestamp) {
    let decreaseBlocks = (block.timestamp - targetTimestamp) / averageBlockTime;
    decreaseBlocks = parseInt(decreaseBlocks);

    if (decreaseBlocks < 1) {
      break;
    }

    blockNumber -= decreaseBlocks;
    block = await web3.eth.getBlock(blockNumber);
  }

  if (lowerLimitStamp && block.timestamp < lowerLimitStamp) {
    while (block.timestamp < lowerLimitStamp) {
      blockNumber += 1;
      block = await web3.eth.getBlock(blockNumber);
    }
  }

  // If we ended with a block higher than we can walk block by block to find the correct one.
  if (higherLimitStamp) {
    if (block.timestamp >= higherLimitStamp) {
      while (block.timestamp >= higherLimitStamp) {
        blockNumber -= 1;
        block = await web3.eth.getBlock(blockNumber);
      }
    }

    // If we ended up with a block lower than the upper limit  walk block by block to make sure it's the correct one.
    if (block.timestamp < higherLimitStamp) {
      while (block.timestamp < higherLimitStamp) {
        blockNumber += 1;
        if (blockNumber > currentBlockNumber) break;
        const tempBlock = await web3.eth.getBlock(blockNumber);
        // Can't be equal or higher than upper limit as we want to find the last block before that limit.
        if (tempBlock.timestamp >= higherLimitStamp) {
          break;
        }
        block = tempBlock;
      }
    }
  }
  return { blockNumber: block.number, error: Math.abs(targetTimestamp - block.timestamp) };
}

FindBlockAtTimeStamp._findBlockNumberAtTimestamp = _findBlockNumberAtTimestamp;
module.exports = FindBlockAtTimeStamp;
