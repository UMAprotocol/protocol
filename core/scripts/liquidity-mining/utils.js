require("dotenv").config();
const fetch = require("node-fetch");

const SUBGRAPH_URL = process.env.SUBGRAPH_URL || "https://api.thegraph.com/subgraphs/name/balancer-labs/balancer";

// Find information about a given balancer pool `shares` returns a list of all historic LP providers.
async function fetchBalancerPoolInfo(poolAddress) {
  const query = `
        {
          pools (where: {id: "${poolAddress}"}) {
            id
            shares (first: 1000) {
              userAddress {
                id
              }
            }
          }
        }
    `;

  const response = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      query
    })
  });

  const { data } = await response.json();

  return data.pools[0];
}

// Finds the block number closest to a given timestamp. `higherLimitMax` & `lowerLimitMax` place bounds
// on the time stamp error on either side of the found blocknumber.
async function findBlockNumberAtTimestamp(web3, targetTimestamp, higherLimitMax = 30, lowerLimitMax = 30) {
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
  return block.number;
}

module.exports = {
  fetchBalancerPoolInfo,
  findBlockNumberAtTimestamp
};
