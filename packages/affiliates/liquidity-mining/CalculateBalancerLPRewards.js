// This script calculates $UMA liquidity mining rewards for Balancer Pools. This is done with the following process:
// -> Define the starting and ending blockheight of each week.
// -> Define snapshot blocks (eg every 64 blocks ~15min). For each snapshot block, calculate the proportional liquidity
// provided by for each liquidity provider to the single whitelisted pool.
// -> For each snapshot block, calculate the $UMA rewards to be received by each liquidity provider based on the target weekly distribution.

// Example usage from core: node ./scripts/liquidity-mining/CalculateBalancerLPRewards.js --network mainnet_mnemonic \
// --poolAddress="0x0099447ef539718bba3c4d4d4b4491d307eedc53" --fromBlock 10725993 --toBlock 10752010 --week = 1

// Set the archival node using: export CUSTOM_NODE_URL=<your node here>
const cliProgress = require("cli-progress");
require("dotenv").config();
const Promise = require("bluebird");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
const { getAbi } = require("@uma/core");
const { getWeb3 } = require("@uma/common");
const web3 = getWeb3();

const { toWei, toBN, fromWei } = web3.utils;

const argv = require("minimist")(process.argv.slice(), {
  string: ["poolAddress", "tokenName"],
  integer: ["fromBlock", "toBlock", "week", "umaPerWeek", "blocksPerSnapshot"]
});

async function calculateBalancerLPRewards(
  fromBlock,
  toBlock,
  tokenName,
  poolAddress,
  week,
  umaPerWeek = 25000,
  blocksPerSnapshot = 256
) {
  // Create two moment objects from the input string. Convert to UTC time zone. As no time is provided in the input
  // will parse to 12:00am UTC.
  if (!web3.utils.isAddress(poolAddress) || !fromBlock || !toBlock || !week || !tokenName) {
    throw new Error("Missing or invalid parameter! Provide poolAddress, fromBlock, toBlock, week & tokenName");
  }

  console.log(`🔥Starting $UMA Balancer liquidity provider script for ${tokenName}🔥`);

  // Calculate the total number of snapshots over the interval.
  const snapshotsToTake = Math.ceil((toBlock - fromBlock) / blocksPerSnapshot);

  // $UMA per snapshot is the total $UMA for a given week, divided by the number of snapshots to take.
  const umaPerSnapshot = toBN(toWei(umaPerWeek.toString())).div(toBN(snapshotsToTake.toString()));
  console.log(
    `🔎 Capturing ${snapshotsToTake} snapshots and distributing ${fromWei(
      umaPerSnapshot
    )} $UMA per snapshot.\n💸 Total $UMA to be distributed distributed: ${fromWei(
      umaPerSnapshot.muln(snapshotsToTake)
    )}`
  );

  console.log("⚖️  Finding balancer pool info...");
  // Get the information on a particular pool. This includes a mapping of all previous token holders (shareholders).
  const poolInfo = await _fetchBalancerPoolInfo(poolAddress);

  // Extract the addresses of all historic shareholders.
  const shareHolders = poolInfo.shares.flatMap(a => a.userAddress.id);
  console.log("🏖  Number of historic liquidity providers:", shareHolders.length);

  let bPool = new web3.eth.Contract(getAbi("ERC20"), poolAddress);

  const shareHolderPayout = await _calculatePayoutsBetweenBlocks(
    bPool,
    shareHolders,
    fromBlock,
    toBlock,
    blocksPerSnapshot,
    umaPerSnapshot,
    snapshotsToTake
  );

  console.log("🎉 Finished calculating payouts!");
  _saveShareHolderPayout(
    shareHolderPayout,
    week,
    fromBlock,
    toBlock,
    tokenName,
    poolAddress,
    blocksPerSnapshot,
    umaPerWeek
  );
}

// Calculate the payout to a list of `shareHolders` between `fromBlock` and `toBlock`. Split the block window up into
// chunks of `blockPerSnapshot` and at each chunk assign `umaPerSnapshot` at a prorata basis.
async function _calculatePayoutsBetweenBlocks(
  bPool,
  shareHolders,
  fromBlock,
  toBlock,
  blocksPerSnapshot,
  umaPerSnapshot,
  snapshotsToTake
) {
  // Create a structure to store the payouts for all historic shareholders.
  let shareHolderPayout = {};
  for (let shareHolder of shareHolders) {
    shareHolderPayout[shareHolder] = toBN("0");
  }

  console.log("🏃‍♂️Iterating over block range and calculating payouts...");

  // create new progress bar to show the status of blocks traversed.
  const progressBar = new cliProgress.SingleBar(
    {
      format: "[{bar}] {percentage}% | snapshots traversed: {value}/{total}"
    },
    cliProgress.Presets.shades_classic
  );
  progressBar.start(snapshotsToTake, 0);
  for (let currentBlock = fromBlock; currentBlock < toBlock; currentBlock += blocksPerSnapshot) {
    console.log("a");
    shareHolderPayout = await _updatePayoutAtBlock(bPool, currentBlock, shareHolderPayout, umaPerSnapshot);
    console.log("b");
    progressBar.update(Math.ceil((currentBlock - fromBlock) / blocksPerSnapshot) + 1);
    console.log("c");
  }
  progressBar.stop();

  return shareHolderPayout;
}

// For a given `blockNumber` (snapshot in time), return an updated `shareHolderPayout` object that has appended
// payouts for a given `bPool` at a rate of `umaPerSnapshot`.
async function _updatePayoutAtBlock(bPool, blockNumber, shareHolderPayout, umaPerSnapshot) {
  // Get the total supply of Balancer Pool tokens at the given snapshot's block number.
  console.log("a.1");
  let bptSupplyAtSnapshot;
  try {
    bptSupplyAtSnapshot = toBN(await bPool.methods.totalSupply().call(undefined, blockNumber));
  } catch (error) {
    return shareHolderPayout;
  }
  console.log("a.2");
  // Get the given holders balance at the given block. Generate an array of promises to resolve in parallel.
  const balanceResults = await Promise.map(
    Object.keys(shareHolderPayout),
    shareHolder => bPool.methods.balanceOf(shareHolder).call(undefined, blockNumber),
    {
      concurrency: 50 // Keep infura happy about the number of incoming requests.
    }
  );
  // For each balance result, calculate their associated payment addition.
  balanceResults.forEach(function(balanceResult, index) {
    // If the given shareholder had no BLP tokens at the given block, skip them.
    if (balanceResult === "0") return;
    // The holders fraction is the number of BPTs at the block divided by the total supply at that block.
    const shareHolderBalanceAtSnapshot = toBN(balanceResult);
    const shareHolderFractionAtSnapshot = toBN(toWei("1"))
      .mul(shareHolderBalanceAtSnapshot)
      .div(bptSupplyAtSnapshot);

    // The payout at the snapshot for the holder is their pro-rata fraction of per-snapshot rewards.
    const shareHolderPayoutAtSnapshot = shareHolderFractionAtSnapshot.mul(toBN(umaPerSnapshot)).div(toBN(toWei("1")));

    // Lastly, update the payout object for the given shareholder. This is their previous payout value + their new payout.
    const shareHolderAddress = Object.keys(shareHolderPayout)[index];
    shareHolderPayout[shareHolderAddress] = shareHolderPayout[shareHolderAddress].add(shareHolderPayoutAtSnapshot);
  });
  return shareHolderPayout;
}

// Generate a json file containing the shareholder output address and associated $UMA token payouts.
function _saveShareHolderPayout(
  shareHolderPayout,
  week,
  fromBlock,
  toBlock,
  tokenName,
  poolAddress,
  blocksPerSnapshot,
  umaPerWeek
) {
  // First, clean the shareHolderPayout of all zero recipients and convert from wei scaled number.
  for (let shareHolder of Object.keys(shareHolderPayout)) {
    if (shareHolderPayout[shareHolder].toString() == "0") delete shareHolderPayout[shareHolder];
    else shareHolderPayout[shareHolder] = fromWei(shareHolderPayout[shareHolder]);
  }

  // Format output and save to file.
  const outputObject = { week, fromBlock, toBlock, poolAddress, blocksPerSnapshot, umaPerWeek, shareHolderPayout };
  const savePath = `${path.resolve(__dirname)}/${tokenName}-weekly-payouts/Week_${week}_Mining_Rewards.json`;
  fs.writeFileSync(savePath, JSON.stringify(outputObject));
  console.log("🗄  File successfully written to", savePath);
}

// Find information about a given balancer `poolAddress` `shares` returns a list of all historic LP providers.
async function _fetchBalancerPoolInfo(poolAddress) {
  const SUBGRAPH_URL = process.env.SUBGRAPH_URL || "https://api.thegraph.com/subgraphs/name/balancer-labs/balancer";
  const query = `
        {
          pools (where: {id: "${poolAddress.toLowerCase()}"}) {
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
    body: JSON.stringify({ query })
  });
  const data = (await response.json()).data;
  if (data.pools.length > 0) {
    return data.pools[0];
  }
  throw "⚠️  Balancer pool provided is not indexed in the subgraph or bad address!";
}

// Implement async callback to enable the script to be run by truffle or node.
async function Main(callback) {
  try {
    // Pull the parameters from process arguments. Specifying them like this lets tests add its own.
    await calculateBalancerLPRewards(
      argv.fromBlock,
      argv.toBlock,
      argv.tokenName,
      argv.poolAddress,
      argv.week,
      argv.umaPerWeek,
      argv.blocksPerSnapshot
    );
  } catch (error) {
    console.error(error);
  }
  callback();
}

function nodeCallback(err) {
  if (err) {
    console.error(err);
    process.exit(1);
  } else process.exit(0);
}

// If called directly by node, execute the Poll Function. This lets the script be run as a node process.
if (require.main === module) {
  Main(nodeCallback)
    .then(() => {})
    .catch(nodeCallback);
}

// Each function is then appended onto to the `Main` which is exported. This enables these function to be tested.
Main.calculateBalancerLPRewards = calculateBalancerLPRewards;
Main._calculatePayoutsBetweenBlocks = _calculatePayoutsBetweenBlocks;
Main._updatePayoutAtBlock = _updatePayoutAtBlock;
Main._saveShareHolderPayout = _saveShareHolderPayout;
Main._fetchBalancerPoolInfo = _fetchBalancerPoolInfo;
module.exports = Main;
