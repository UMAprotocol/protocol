require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { getAbi } = require("@uma/contracts-node");
const { getWeb3 } = require("@uma/common");
const web3 = getWeb3();
const { _fetchBalancerPoolInfo, _calculatePayoutsBetweenBlocks } = require("./CalculateBalancerLPRewards"); // re-use balancer query function.

const { toWei, toBN, fromWei, isAddress } = web3.utils;

const argv = require("minimist")(process.argv.slice(), {
  string: ["pool1Address", "pool2Address", "tokenName"],
  integer: [
    "fromBlock1",
    "toBlock1",
    "fromBlock2",
    "toBlock2",
    "week",
    "umaPerPeriod1",
    "umaPerPeriod2",
    "blocksPerSnapshot",
  ],
});

async function calculateSplitPoolBalancerLPProviders(
  fromBlock1,
  toBlock1,
  fromBlock2,
  toBlock2,
  tokenName,
  pool1Address,
  pool2Address,
  week,
  umaPerPeriod1,
  umaPerPeriod2,
  blocksPerSnapshot = 256
) {
  // Create two moment objects from the input string. Convert to UTC time zone. As no time is provided in the input
  // will parse to 12:00am UTC.
  if (
    !isAddress(pool1Address) ||
    !isAddress(pool2Address) ||
    !fromBlock1 ||
    !toBlock1 ||
    !fromBlock2 ||
    !toBlock2 ||
    !week ||
    !tokenName ||
    !umaPerPeriod1 ||
    !umaPerPeriod2
  ) {
    throw new Error(
      "Missing or invalid parameter! Provide pool1Address, pool2Address fromBlock1, toBlock1, fromBlock2, toBlock2, week, tokenName, umaPerPeriod1, umaPerPeriod2"
    );
  }

  console.log(`🔥Starting $UMA Balancer split pool liquidity provider script for ${tokenName}🔥`);

  // Calculate the total number of snapshots over the interval.
  const snapshotsToTake1 = Math.ceil((toBlock1 - fromBlock1) / blocksPerSnapshot);
  const snapshotsToTake2 = Math.ceil((toBlock2 - fromBlock2) / blocksPerSnapshot);

  // $UMA per snapshot is the total $UMA for a given week, divided by the number of snapshots to take.
  const umaPerSnapshot1 = toBN(toWei(umaPerPeriod1.toString())).div(toBN(snapshotsToTake1.toString()));
  const umaPerSnapshot2 = toBN(toWei(umaPerPeriod2.toString())).div(toBN(snapshotsToTake2.toString()));
  console.log(
    `🔎 For period 1: capturing ${snapshotsToTake1} snapshots and distributing ${fromWei(
      umaPerSnapshot1
    )} $UMA per snapshot.\n💸 Total $UMA to be distributed distributed: ${fromWei(
      umaPerSnapshot1.muln(snapshotsToTake1)
    )}`
  );
  console.log(
    `🔎 For period 2: capturing ${snapshotsToTake2} snapshots and distributing ${fromWei(
      umaPerSnapshot2
    )} $UMA per snapshot.\n💸 Total $UMA to be distributed distributed: ${fromWei(
      umaPerSnapshot2.muln(snapshotsToTake2)
    )}`
  );

  console.log("⚖️  Finding balancer pool info...");
  // Get the information on a particular pool. This includes a mapping of all previous token holders (shareholders).
  const poolInfo1 = await _fetchBalancerPoolInfo(pool1Address);
  const poolInfo2 = await _fetchBalancerPoolInfo(pool2Address);

  // Extract the addresses of all historic shareholders.
  const shareHolders1 = poolInfo1.shares.flatMap((a) => a.userAddress.id);
  console.log("🏖  Number of historic liquidity providers pool1:", shareHolders1.length);

  const shareHolders2 = poolInfo2.shares.flatMap((a) => a.userAddress.id);
  console.log("🏖  Number of historic liquidity providers pool2:", shareHolders2.length);

  let bPool1 = new web3.eth.Contract(getAbi("ERC20"), pool1Address);
  let bPool2 = new web3.eth.Contract(getAbi("ERC20"), pool2Address);

  console.log("🧮 Calculating shareholder payout for first period");
  const shareHolderPayout1 = await _calculatePayoutsBetweenBlocks(
    bPool1,
    shareHolders1,
    fromBlock1,
    toBlock1,
    blocksPerSnapshot,
    umaPerSnapshot1,
    snapshotsToTake1
  );

  console.log("🧮 Calculating shareholder payout for second period");
  const shareHolderPayout2 = await _calculatePayoutsBetweenBlocks(
    bPool2,
    shareHolders2,
    fromBlock2,
    toBlock2,
    blocksPerSnapshot,
    umaPerSnapshot2,
    snapshotsToTake2
  );

  const joinedShareHolderPayout = await _joinPayoutPeriods(shareHolderPayout1, shareHolderPayout2);

  console.log("🎉 Finished calculating payouts!");
  _saveShareHolderPayout(
    shareHolderPayout1,
    shareHolderPayout2,
    joinedShareHolderPayout,
    week,
    fromBlock1,
    toBlock1,
    fromBlock2,
    toBlock2,
    tokenName,
    pool1Address,
    pool2Address,
    blocksPerSnapshot,
    umaPerPeriod1,
    umaPerPeriod2
  );
}

async function _joinPayoutPeriods(shareHolderPayout1, shareHolderPayout2) {
  // Cast to back and forth with JSON to create a deep copy.
  let joinedOutput = Object.assign({}, shareHolderPayout1);

  for (const sponsor of Object.keys(shareHolderPayout2)) {
    // if the joinedOutput already contains the sponsor key from shareHolderPayout2 then add the payouts together
    if (shareHolderPayout1[sponsor]) {
      joinedOutput[sponsor] = shareHolderPayout1[sponsor].add(shareHolderPayout2[sponsor]);
      // else, if it does not, then add in the second set of payout
    } else {
      joinedOutput[sponsor] = shareHolderPayout2[sponsor];
    }
  }
  return joinedOutput;
}

// Generate a json file containing the shareholder output address and associated $UMA token payouts.
function _saveShareHolderPayout(
  shareHolderPayout1,
  shareHolderPayout2,
  joinedShareHolderPayout,
  week,
  fromBlock1,
  toBlock1,
  fromBlock2,
  toBlock2,
  tokenName,
  pool1Address,
  pool2Address,
  blocksPerSnapshot,
  umaPerPeriod1,
  umaPerPeriod2
) {
  // First, clean the shareHolderPayout of all zero recipients and convert from wei scaled number.
  for (let shareHolder of Object.keys(shareHolderPayout1)) {
    if (shareHolderPayout1[shareHolder].toString() == "0") delete shareHolderPayout1[shareHolder];
    else shareHolderPayout1[shareHolder] = fromWei(shareHolderPayout1[shareHolder]);
  }

  // First, clean the shareHolderPayout of all zero recipients and convert from wei scaled number.
  for (let shareHolder of Object.keys(shareHolderPayout2)) {
    if (shareHolderPayout2[shareHolder].toString() == "0") delete shareHolderPayout2[shareHolder];
    else shareHolderPayout2[shareHolder] = fromWei(shareHolderPayout2[shareHolder]);
  }

  // First, clean the shareHolderPayout of all zero recipients and convert from wei scaled number.
  for (let shareHolder of Object.keys(joinedShareHolderPayout)) {
    if (joinedShareHolderPayout[shareHolder].toString() == "0") delete joinedShareHolderPayout[shareHolder];
    else joinedShareHolderPayout[shareHolder] = fromWei(joinedShareHolderPayout[shareHolder]);
  }

  // Format output and save to file.
  const outputObject = {
    week,
    splitPeriodFromBlock1: fromBlock1,
    splitPeriodToBlock1: toBlock1,
    splitPeriodFromBlock2: fromBlock2,
    splitPeriodToBlock2: toBlock2,
    tokenName,
    splitPeriodPool1Address: pool1Address,
    splitPeriodPool2Address: pool2Address,
    blocksPerSnapshot,
    splitUmaPerPeriod1: umaPerPeriod1,
    splitUmaPerPeriod2: umaPerPeriod2,
    shareHolderPayout: joinedShareHolderPayout,
    splitPeriodShareHolderPayout1: shareHolderPayout1,
    splitPeriodShareHolderPayout2: shareHolderPayout2,
  };
  const savePath = `${path.resolve(__dirname)}/${tokenName}-weekly-payouts/Week_${week}_Mining_Rewards.json`;
  fs.writeFileSync(savePath, JSON.stringify(outputObject));
  console.log("🗄  File successfully written to", savePath);
}

// Implement async callback to enable the script to be run by truffle or node.
async function Main(callback) {
  try {
    // Pull the parameters from process arguments. Specifying them like this lets tests add its own.
    await calculateSplitPoolBalancerLPProviders(
      argv.fromBlock1,
      argv.toBlock1,
      argv.fromBlock2,
      argv.toBlock2,
      argv.tokenName,
      argv.pool1Address,
      argv.pool2Address,
      argv.week,
      argv.umaPerPeriod1,
      argv.umaPerPeriod2,
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
module.exports = Main;
