// This script calculates $UMA liquidity mining rewards during a roll between two Balancer Pools. This is done with the following process:
// -> Define the starting and ending blockheight of each week.
// -> Define snapshot blocks (eg every 64 blocks ~15min). For each snapshot block, calculate the proportional liquidity
// provided by for each liquidity provider over the two pools (sum of liquidity provided).
// -> For each snapshot block, calculate the $UMA rewards to be received by each liquidity provider based on the target weekly distribution.
// -> This calculation considers the total yUSD between the two pools in the roll, using the following formula:
// myReward = totalUMAPayout * (myyUSDinBP1 + myyUSDinBP2) / (totalyUSDinBP1 + totalyUSDinBP2)

// Example usage from core: node ./scripts/liquidity-mining/CalculateRollBalancerLPRewards.js --fromBlock 10725993 --toBlock 10752010 --pool1Address="0x58EF3abAB72c6C365D4D0D8a70039752b9f32Bc9" --pool2Address="0xd2f574637898526fcddfb3d487cc73c957fa0268" --tokenName="yusdeth" --rollNum=1 --umaPerWeek=25000 --blocksPerSnapshot=2056 --synth1Address="0x81ab848898b5ffD3354dbbEfb333D5D183eEDcB5" --synth2Address="0xB2FdD60AD80ca7bA89B9BAb3b5336c2601C020b4"
// Set the archival node using: export CUSTOM_NODE_URL=<your node here>

const cliProgress = require("cli-progress");
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const Web3 = require("web3");
const erc20 = require("../../build/contracts/ERC20.json");
const { _fetchBalancerPoolInfo } = require("./CalculateBalancerLPRewards"); // re-use balancer query function.
const { delay } = require("@uma/financial-templates-lib");

const web3 = new Web3(new Web3.providers.HttpProvider(process.env.CUSTOM_NODE_URL));

const { toWei, toBN, fromWei, isAddress } = web3.utils;

const argv = require("minimist")(process.argv.slice(), {
  string: ["pool1Address", "pool2Address", "synth1Address", "synth2Address", "tokenName"],
  integer: ["fromBlock", "toBlock", "rollNum", "umaPerWeek", "blocksPerSnapshot"]
});

async function calculateRollBalancerLPProviders(
  fromBlock,
  toBlock,
  tokenName,
  pool1Address,
  pool2Address,
  synth1Address,
  synth2Address,
  rollNum,
  umaPerWeek = 25000,
  blocksPerSnapshot = 256
) {
  // Create two moment objects from the input string. Convert to UTC time zone. As no time is provided in the input
  // will parse to 12:00am UTC.
  if (
    !isAddress(pool1Address) ||
    !isAddress(pool2Address) ||
    !isAddress(synth1Address) ||
    !isAddress(synth2Address) ||
    !fromBlock ||
    !toBlock ||
    !rollNum ||
    !tokenName
  ) {
    throw new Error(
      "Missing or invalid parameter! Provide pool1Address, pool2Address, synth1Address, synth2Address, fromBlock, toBlock, rollNum & tokenName"
    );
  }

  console.log(`🔥 Starting $UMA Balancer liquidity provider Rolling script for ${tokenName}🔥`);
  console.log(`🎢 Calculating for roll # ${rollNum}. Rolling between pool ${pool1Address} and ${pool2Address}`);

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

  const bPool1 = new web3.eth.Contract(erc20.abi, pool1Address);
  const bPool2 = new web3.eth.Contract(erc20.abi, pool2Address);
  const synth1 = new web3.eth.Contract(erc20.abi, synth1Address);
  const synth2 = new web3.eth.Contract(erc20.abi, synth2Address);

  const shareHolderPayout = await _calculatePayoutsBetweenBlocks(
    bPool1,
    bPool2,
    synth1,
    synth2,
    shareHolders,
    fromBlock,
    toBlock,
    blocksPerSnapshot,
    umaPerSnapshot
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
  synth1,
  synth2,
  shareHolders,
  fromBlock,
  toBlock,
  blocksPerSnapshot,
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
  progressBar.start(Math.ceil((toBlock - fromBlock) / blocksPerSnapshot), 0);
  for (currentBlock = fromBlock; currentBlock < toBlock; currentBlock += blocksPerSnapshot) {
    shareHolderPayout = await _updatePayoutAtBlock(
      bPool1,
      bPool2,
      synth1,
      synth2,
      currentBlock,
      shareHolderPayout,
      umaPerSnapshot
    );
    progressBar.update(Math.ceil((currentBlock - fromBlock) / blocksPerSnapshot) + 1);
  }
  progressBar.stop();

  return shareHolderPayout;
}

// For a given `blockNumber` (snapshot in time), return an updated `shareHolderPayout` object that has appended
// payouts for given `bPool1` and `bPool2` at a rate of `umaPerSnapshot`.
// myReward = (totalUMAPayout * (myyUSDinBP1 + myyUSDinBP2)) / (totalyUSDinBP1 + totalyUSDinBP2);
async function _updatePayoutAtBlock(bPool1, bPool2, synth1, synth2, blockNumber, shareHolderPayout, umaPerSnapshot) {
  // Get the total supply of Balancer Pool tokens at the given snapshot's block number.
  const bptPool1Supply = toBN(await bPool1.methods.totalSupply().call(undefined, blockNumber));
  const bptPool2Supply = toBN(await bPool2.methods.totalSupply().call(undefined, blockNumber));

  // Get the number of synths in the balancer pool at the given block number.
  const bPoo1Synth1Balance = toBN(await synth1.methods.balanceOf(bPool1._address).call(undefined, blockNumber));
  const bPoo2Synth2Balance = toBN(await synth2.methods.balanceOf(bPool2._address).call(undefined, blockNumber));

  // Calculate the value of each bpt in synth tokens. This represents how many synths each BPT would be redeemable for.
  // Check that the supply is not zero first. if it's not zero then the value of the bpt = PoolSynthBalance/bptSupply
  // prettier-ignore
  const bpt1Synth1Price =
    bptPool1Supply.toString() != "0"
      ? toBN(toWei("1"))
        .mul(bPoo1Synth1Balance)
        .div(bptPool1Supply)
      : toBN("0");

  // prettier-ignore
  const bpt2Synth2Price =
    bptPool2Supply.toString() != "0"
      ? toBN(toWei("1"))
        .mul(bPoo2Synth2Balance)
        .div(bptPool2Supply)
      : toBN("0");

  // Get the given holders balance at the given block. Generate an array of promises to resolve in parallel.
  let promiseArraybPool1 = [];
  let promiseArraybPool2 = [];
  for (shareHolder of Object.keys(shareHolderPayout)) {
    promiseArraybPool1.push(bPool1.methods.balanceOf(shareHolder).call(undefined, blockNumber));
    promiseArraybPool2.push(bPool2.methods.balanceOf(shareHolder).call(undefined, blockNumber));
  }
  const balanceResultsbPool1 = await Promise.allSettled(promiseArraybPool1);
  await delay(5); // slow down the queries between these massive promise arrays. Helps to keep Infura happy.
  const balanceResultsbPool2 = await Promise.allSettled(promiseArraybPool2);
  // For each balance result, calculate their associated payment addition.
  for ([index, shareHolder] of Object.keys(shareHolderPayout).entries()) {
    // If the given shareholder had no BLP tokens at the given block, skip them.
    if (balanceResultsbPool1[index].value === "0" && balanceResultsbPool2[index].value === "0") continue;
    // Calculate the shareholders pool1 value by taking their balance of BPT * BPT price.

    const shareHolderPool1Value = toBN(balanceResultsbPool1[index].value)
      .mul(bpt1Synth1Price)
      .div(toBN(toWei("1")));

    // Calculate the shareholders pool2 value by taking their balance of BPT * BPT price.
    const shareHolderPool2Value = toBN(balanceResultsbPool2[index].value)
      .mul(bpt2Synth2Price)
      .div(toBN(toWei("1")));

    // Their fraction of ownership of both pools is thus: myFrac = (myUSDinBP1 + myUSDinBP2)) / (totalyUSDinBP1 + totalyUSDinBP2)
    const shareHolderFraction = toBN(toWei("1"))
      .mul(shareHolderPool1Value.add(shareHolderPool2Value))
      .div(bPoo1Synth1Balance.add(bPoo2Synth2Balance));

    // The payout at the snapshot for the holder is their pro-rata fraction of per-snapshot rewards as
    // Their fraction of ownership of both pools is thus: totalUMAPayout * myFrac
    const shareHolderPayoutInUma = shareHolderFraction.mul(toBN(umaPerSnapshot)).div(toBN(toWei("1")));

    // Lastly, update the payout object for the given shareholder. This is their previous payout value + their new payout.
    shareHolderPayout[shareHolder] = shareHolderPayout[shareHolder].add(shareHolderPayoutInUma);
  }
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
      argv.synth1Address,
      argv.synth2Address,
      argv.rollNum,
      argv.umaPerWeek,
      argv.blocksPerSnapshot,
      argv.collateralAddress
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
