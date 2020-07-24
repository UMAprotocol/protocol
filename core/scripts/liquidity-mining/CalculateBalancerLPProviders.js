// This script calculates $UMA liquidity mining rewards for Balancer Pools. This is done with the following process:
// -> Define the starting and ending blockheight of each week. Both are chosen as the block with the closest timestamp
// to a fixed weekly time(e.g.2020-06-06 00:00pm UTC).
// -> Define snapshot blocks (eg every 64 blocks ~15min). For each snapshot block, calculate the proportional liquidity
// provided by for each liquidity provider to the single whitelisted pool.
// -> For each snapshot block, calculate the $UMA rewards to be received by each liquidity provider based on the target weekly distribution.

// Example usage from core: truffle exec ./scripts/liquidity-mining/calculateBalancerLPProviders.js --network mainnet_mnemonic --poolAddress="0x0099447ef539718bba3c4d4d4b4491d307eedc53" --fromDate="2020-07-06" --toDate="2020-07-13" --week=1

// Set the archival node using: export CUSTOM_NODE_URL=<your node here>

const moment = require("moment");
const cliProgress = require("cli-progress");
const fs = require("fs");
const path = require("path");
const Web3 = require("web3");
const utils = require("./utils");
const poolAbi = require("../../build/contracts/ERC20.json");
require("dotenv").config();

const web3 = new Web3(new Web3.providers.HttpProvider(process.env.CUSTOM_NODE_URL));

const { toWei, toBN, fromWei } = web3.utils;

const argv = require("minimist")(process.argv.slice(), {
  string: ["poolAddress", "fromDate", "toDate"],
  integer: ["week"],
  boolean: ["test"]
});

const UMA_PER_WEEK = toBN(toWei("25000"));
const BLOCKS_PER_SNAPSHOT = 64;
let umaPerSnapshot;

async function calculateBalancerLPProviders(fromDate, toDate, poolAddress, week) {
  // Create two moment objects from the input string. Convert to UTC time zone. As no time is provided in the input
  // will parse to 12:00am UTC.
  fromDate = moment.utc(fromDate, "YYYY-MM-DD");
  toDate = moment.utc(toDate, "YYYY-MM-DD");
  if (!web3.utils.isAddress(poolAddress) || !fromDate.isValid() || !toDate.isValid() || !week) {
    throw "Missing or invalid parameter! Provide poolAddress, fromDate, toDate & week. fromDate and toDate must be strings formatted YYYY-MM-DD";
  }

  console.log("🔥Starting $UMA Balancer liquidity provider script🔥");
  // Get the closet block numbers on each side of the from and to date, within an error band of 30 seconds (~2 blocks).
  const fromBlock = await utils.findBlockNumberAtTimestamp(web3, fromDate.unix());

  const toBlock = await utils.findBlockNumberAtTimestamp(web3, toDate.unix());
  console.table({
    "Search from": {
      Date: fromDate.format("dddd, MMMM Do YYYY, h:mm:ss a"),
      "Unix timestamp": fromDate.unix(),
      "Block number": fromBlock
    },
    "Search until": {
      Date: toDate.format("dddd, MMMM Do YYYY, h:mm:ss a"),
      "Unix timestamp": toDate.unix(),
      "Block number": toBlock
    }
  });

  // Calculate the total number of snapshots over the interval.
  const snapshotsToTake = Math.ceil((toBlock - fromBlock) / BLOCKS_PER_SNAPSHOT);

  // $UMA per snapshot is the total $UMA for a given week, divided by the number of snapshots to take.
  umaPerSnapshot = UMA_PER_WEEK.div(toBN(snapshotsToTake.toString()));
  console.log(
    `🔎 Capturing ${snapshotsToTake} snapshots and distributing ${fromWei(
      umaPerSnapshot
    )} $UMA per snapshot.\n💸 Total $UMA to be distributed distributed: ${fromWei(
      umaPerSnapshot.muln(snapshotsToTake)
    )}`
  );

  console.log("⚖️  Finding balancer pool info...");
  // Get the information on a particular pool. This includes a mapping of all previous token holders (shareholders).
  const poolInfo = await utils.fetchBalancerPoolInfo(poolAddress);

  // Extract the addresses of all historic shareholders.
  const shareHolders = poolInfo.shares.flatMap(a => a.userAddress.id);
  console.log("🏖  Number of historic liquidity providers:", shareHolders.length);

  let bPool = new web3.eth.Contract(poolAbi.abi, poolAddress);

  const shareHolderPayout = await _calculatePayoutsBetweenBlocks(
    bPool,
    shareHolders,
    fromBlock,
    toBlock,
    BLOCKS_PER_SNAPSHOT,
    umaPerSnapshot,
    snapshotsToTake
  );

  console.log("🎉 Finished calculating payouts!");
  _saveShareHolderPayout(shareHolderPayout, week);
}

// Calculate the payout to a list of `shareHolders` between `fromBlock` and `toBlock`. Split the block window up into
// chunks of `blockPerSnapshot` and at each chunk assign `umaPerSnapshot` at a prorata basis.
async function _calculatePayoutsBetweenBlocks(
  bPool,
  shareHolders,
  fromBlock,
  toBlock,
  blockPerSnapshot,
  umaPerSnapshot
) {
  // Create a structure to store the payouts for all historic shareholders.
  let shareHolderPayout = {};
  for (shareHolder of shareHolders) {
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
  progressBar.start(Math.ceil((toBlock - fromBlock) / blockPerSnapshot), 0);
  for (currentBlock = fromBlock; currentBlock < toBlock; currentBlock += blockPerSnapshot) {
    shareHolderPayout = await _updatePayoutAtBlock(bPool, currentBlock, shareHolderPayout, umaPerSnapshot);
    progressBar.update(Math.ceil((currentBlock - fromBlock) / blockPerSnapshot) + 1);
  }
  progressBar.stop();

  return shareHolderPayout;
}

// For a given `blockNumber` (snapshot in time), return an updated `shareHolderPayout` object that has appended
// payouts for a given `bPool` at a rate of `umaPerSnapshot`.
async function _updatePayoutAtBlock(bPool, blockNumber, shareHolderPayout, umaPerSnapshot) {
  // Get the total supply of Balancer Pool tokens at the given snapshot's block number.
  const bptSupplyAtSnapshot = toBN(await bPool.methods.totalSupply().call(undefined, blockNumber));

  // Get the given holders balance at the given block. Generate an array of promises to resolve in parallel.
  let promiseArray = [];
  for (shareHolder of Object.keys(shareHolderPayout)) {
    promiseArray.push(await bPool.methods.balanceOf(shareHolder).call(undefined, blockNumber));
  }

  const balanceResults = await Promise.allSettled(promiseArray);

  // For each balance result, calculate their associated payment addition.
  balanceResults.forEach(function(balanceResult, index) {
    // If the given shareholder had no BLP tokens at the given block, skip them.
    if (balanceResult.value === "0") return;
    // The holders fraction is the number of BPTs at the block divided by the total supply at that block.
    const shareHolderBalanceAtSnapshot = toBN(balanceResult.value);
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
function _saveShareHolderPayout(shareHolderPayout, week) {
  // First, clean the shareHolderPayout of all zero recipients and convert from wei scaled number.
  for (shareHolder of Object.keys(shareHolderPayout)) {
    if (shareHolderPayout[shareHolder] == "0") delete shareHolderPayout[shareHolder];
    else shareHolderPayout[shareHolder] = fromWei(shareHolderPayout[shareHolder]);
  }

  const savePath = `${path.resolve(__dirname)}/weekly-payouts/${week}_week_UMAsToDistribute.json`;
  fs.writeFile(savePath, JSON.stringify(shareHolderPayout), err => {
    if (err) return console.error(err);
    console.log("🗄  File successfully written to", savePath);
  });
}

// Function with a callback structured like this is required to enable `truffle exec` to run this script.
async function Main(callback) {
  try {
    // Pull the parameters from process arguments. specifying them like this lets tests add its own.
    await calculateBalancerLPProviders(argv.fromDate, argv.toDate, argv.poolAddress, argv.week);
  } catch (error) {
    console.error(error);
  }
  callback();
}

// Each function is then appended onto to the `Main` which is exported. This enables
Main.calculateBalancerLPProviders = calculateBalancerLPProviders;
Main._calculatePayoutsBetweenBlocks = _calculatePayoutsBetweenBlocks;
Main._updatePayoutAtBlock = _updatePayoutAtBlock;
module.exports = Main;
