// This script calculates $UMA liquidity mining rewards during a roll between two Balancer Pools. This is done with the following process:
// -> Define the starting and ending blockheight of each week.
// -> Define snapshot blocks (eg every 64 blocks ~15min). For each snapshot block, calculate the proportional liquidity
// provided by for each liquidity provider over the two pools (sum of liquidity provided).
// -> For each snapshot block, calculate the $UMA rewards to be received by each liquidity provider based on the target weekly distribution.

// Example usage from core: yarn truffle exec ./scripts/liquidity-mining/CalculateRollBalancerLPRewards.js --network mainnet_mnemonic --pool1Address="0x58EF3abAB72c6C365D4D0D8a70039752b9f32Bc9" --pool2Address="0xd2f574637898526fcddfb3d487cc73c957fa0268" --fromBlock=10719753 --toBlock=10739266 --rollNum=1
// Set the archival node using: export CUSTOM_NODE_URL=<your node here>

const cliProgress = require("cli-progress");
require("dotenv").config();
const fs = require("fs");
const path = require("path");
// const Web3 = require("web3");
const poolAbi = require("../../build/contracts/ERC20.json");
const { _fetchBalancerPoolInfo } = require("./CalculateBalancerLPRewards"); // re-use balancer query function.

// const web3 = new Web3(new Web3.providers.HttpProvider(process.env.CUSTOM_NODE_URL));

const { toWei, toBN, fromWei, isAddress } = web3.utils;

const argv = require("minimist")(process.argv.slice(), {
  string: ["pool1Address", "pool2Address", "fromBlock", "toBlock", "tokenName"],
  integer: ["rollNum", "umaPerWeek", "blocksPerSnapshot"]
});

async function calculateRollBalancerLPProviders(
  fromBlock,
  toBlock,
  tokenName,
  pool1Address,
  pool2Address,
  rollNum,
  umaPerWeek = 25000,
  blocksPerSnapshot = 2056
) {
  // Create two moment objects from the input string. Convert to UTC time zone. As no time is provided in the input
  // will parse to 12:00am UTC.
  if (!isAddress(pool1Address) || !isAddress(pool2Address) || !fromBlock || !toBlock || !rollNum || !tokenName) {
    throw "Missing or invalid parameter! Provide pool1Address, pool2Address, fromBlock, toBlock, rollNum & tokenName";
  }

  console.log("🔥Starting $UMA Balancer liquidity provider Rolling script for ${tokenName}🔥");
  console.log(`🎢Calculating for roll # ${rollNum}. Rolling between pool ${pool1Address} and ${pool2Address}`);

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
  const pool1Info = await _fetchBalancerPoolInfo(pool1Address);
  const pool2Info = await _fetchBalancerPoolInfo(pool2Address);

  // Extract the addresses of all historic shareholders.
  const pool1ShareHolders = pool1Info.shares.flatMap(a => a.userAddress.id);
  const pool2ShareHolders = pool2Info.shares.flatMap(a => a.userAddress.id);
  const shareHolders = [...pool1ShareHolders, ...pool2ShareHolders];
  console.log("🏖  Number of historic liquidity providers:", shareHolders.length);

  let bPool1 = new web3.eth.Contract(poolAbi.abi, pool1Address);
  let bPool2 = new web3.eth.Contract(poolAbi.abi, pool1Address);

  const shareHolderPayout = await _calculatePayoutsBetweenBlocks(
    bPool1,
    bPool2,
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
    rollNum,
    fromBlock,
    toBlock,
    tokenName,
    pool1Address,
    pool2Address,
    umaPerWeek,
    blocksPerSnapshot
  );
}

// Calculate the payout to a list of `shareHolders` between `fromBlock` and `toBlock`. Split the block window up into
// chunks of `blockPerSnapshot` and at each chunk assign `umaPerSnapshot` at a prorata basis.
async function _calculatePayoutsBetweenBlocks(
  bPool1,
  bPool2,
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
    shareHolderPayout = await _updatePayoutAtBlock(bPool1, bPool2, currentBlock, shareHolderPayout, umaPerSnapshot);
    progressBar.update(Math.ceil((currentBlock - fromBlock) / blockPerSnapshot) + 1);
  }
  progressBar.stop();

  return shareHolderPayout;
}

// For a given `blockNumber` (snapshot in time), return an updated `shareHolderPayout` object that has appended
// payouts for a given `bPool` at a rate of `umaPerSnapshot`.
async function _updatePayoutAtBlock(bPool1, bPool2, blockNumber, shareHolderPayout, umaPerSnapshot) {
  // Get the total supply of Balancer Pool tokens at the given snapshot's block number.
  const bptSupplyAtSnapshot = toBN(await bPool1.methods.totalSupply().call(undefined, blockNumber)).add(
    toBN(await bPool2.methods.totalSupply().call(undefined, blockNumber))
  );

  // Get the given holders balance at the given block. Generate an array of promises to resolve in parallel.
  let promiseArraybPool1 = [];
  let promiseArraybPool2 = [];
  for (shareHolder of Object.keys(shareHolderPayout)) {
    promiseArraybPool1.push(bPool1.methods.balanceOf(shareHolder).call(undefined, blockNumber));
    promiseArraybPool2.push(bPool2.methods.balanceOf(shareHolder).call(undefined, blockNumber));
  }
  const balanceResultsbPool1 = await Promise.allSettled(promiseArraybPool1);
  const balanceResultsbPool2 = await Promise.allSettled(promiseArraybPool2);
  // For each balance result, calculate their associated payment addition.
  Object.entries(shareHolderPayout).forEach(function(shareHolder, index) {
    // If the given shareholder had no BLP tokens at the given block, skip them.
    if (balanceResultsbPool1[index].value === "0" && balanceResultsbPool2[index].value === "0") return;
    // The holders fraction is the number of BPTs at the block divided by the total supply at that block.
    const shareHolderBalanceAtSnapshot = toBN(balanceResultsbPool1[index].value).add(
      toBN(balanceResultsbPool2[index].value)
    );
    const shareHolderFractionAtSnapshot = toBN(toWei("1"))
      .mul(shareHolderBalanceAtSnapshot)
      .div(bptSupplyAtSnapshot);

    // The payout at the snapshot for the holder is their pro-rata fraction of per-snapshot rewards.
    const shareHolderPayoutAtSnapshot = shareHolderFractionAtSnapshot.mul(toBN(umaPerSnapshot)).div(toBN(toWei("1")));

    // Lastly, update the payout object for the given shareholder. This is their previous payout value + their new payout.
    const shareHolderAddress = shareHolder[0];
    shareHolderPayout[shareHolderAddress] = shareHolderPayout[shareHolderAddress].add(shareHolderPayoutAtSnapshot);
  });
  return shareHolderPayout;
}

// Generate a json file containing the shareholder output address and associated $UMA token payouts.
function _saveShareHolderPayout(
  shareHolderPayout,
  rollNum,
  fromBlock,
  toBlock,
  tokenName,
  pool1Address,
  pool2Address,
  umaPerWeek,
  blocksPerSnapshot
) {
  // First, clean the shareHolderPayout of all zero recipients and convert from wei scaled number.
  for (shareHolder of Object.keys(shareHolderPayout)) {
    if (shareHolderPayout[shareHolder].toString() == "0") delete shareHolderPayout[shareHolder];
    else shareHolderPayout[shareHolder] = fromWei(shareHolderPayout[shareHolder]);
  }

  // Format output and save to file.
  const outputObject = {
    rollNum,
    fromBlock,
    toBlock,
    pool1Address,
    pool2Address,
    umaPerWeek,
    blocksPerSnapshot,
    shareHolderPayout
  };
  const savePath = `${path.resolve(
    __dirname
  )}/${tokenName}-weekly-payouts/expiring-contract-rolls/Roll_${rollNum}_Mining_Rewards.json`;
  fs.writeFileSync(savePath, JSON.stringify(outputObject));
  console.log("🗄  File successfully written to", savePath);
}

// Function with a callback structured like this is required to enable `truffle exec` to run this script.
async function Main(callback) {
  try {
    // Pull the parameters from process arguments. Specifying them like this lets tests add its own.
    await calculateRollBalancerLPProviders(
      argv.fromBlock,
      argv.toBlock,
      argv.tokenName,
      argv.pool1Address,
      argv.pool2Address,
      argv.rollNum,
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

// Each function is then appended onto to the `Main` which is exported. This enables testing.
Main.calculateRollBalancerLPProviders = calculateRollBalancerLPProviders;
Main._calculatePayoutsBetweenBlocks = _calculatePayoutsBetweenBlocks;
Main._updatePayoutAtBlock = _updatePayoutAtBlock;
Main._saveShareHolderPayout = _saveShareHolderPayout;
module.exports = Main;
