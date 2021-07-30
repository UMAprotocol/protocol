// This script calculates $UMA liquidity mining rewards for Uniswap Pools. This is done with the following process:
// -> Define the starting and ending blockheight of each week.
// -> Define snapshot blocks (eg every 64 blocks ~15min). For each snapshot block, calculate the proportional liquidity
// provided by for each liquidity provider to the single whitelisted pool.
// -> For each snapshot block, calculate the effective balance that each LP added to the pool. The effective balance is
// the minimum of their redeemable synths for their LP tokens and their sponsor position. This acts to enforce that the
// recipient of the LP reward is also a token sponsor.
// -> Using the effective balance, compute the pro-rata contribution of each sponsor.
// Example usage from core: node ./scripts/liquidity-mining/CalculateUniswapLPRewards.js --fromBlock 11356429 \
// --toBlock 11379497 --poolAddress "0x25fb29d865c1356f9e95d621f21366d3a5db6bb0" \
// --empAddress "0x516f595978D87B67401DaB7AfD8555c3d28a3Af4" --umaPerWeek 1000 --tokenName "ugas" --week 1 --network mainnet_mnemonic

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
  string: ["poolAddress", "empAddress", "tokenName"],
  integer: ["fromBlock", "toBlock", "week", "umaPerWeek", "blocksPerSnapshot"],
});

async function calculateUniswapLPRewards(
  fromBlock,
  toBlock,
  tokenName,
  poolAddress,
  empAddress,
  week,
  umaPerWeek = 25000,
  blocksPerSnapshot = 256
) {
  // Create two moment objects from the input string. Convert to UTC time zone. As no time is provided in the input
  // will parse to 12:00am UTC.
  if (
    !web3.utils.isAddress(poolAddress) ||
    !web3.utils.isAddress(empAddress) ||
    !fromBlock ||
    !toBlock ||
    !week ||
    !tokenName
  ) {
    throw new Error(
      "Missing or invalid parameter! Provide poolAddress, empAddress fromBlock, toBlock, week & tokenName"
    );
  }

  console.log(`🔥Starting $UMA Uniswap liquidity provider script for ${tokenName}🔥`);

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

  console.log("⚖️  Finding Uniswap pool info...");
  // Get the information on a particular pool. This includes a mapping of all previous token holders (shareholders).
  const poolInfo = await _fetchUniswapPoolInfo(poolAddress);
  console.log("poolInfo", JSON.stringify(poolInfo));
  // Extract the addresses of all historic shareholders.
  const shareHolders = poolInfo.flatMap((a) => a.user.id);
  console.log("shareHolders", shareHolders);
  console.log("🏖  Number of historic liquidity providers:", shareHolders.length);

  // Initialize the contract we'll need for computation.
  const uniswapPool = new web3.eth.Contract(getAbi("ERC20"), poolAddress);

  const empContract = new web3.eth.Contract(getAbi("ExpiringMultiParty"), empAddress);

  const syntheticTokenAddress = await empContract.methods.tokenCurrency().call();

  const syntheticToken = new web3.eth.Contract(getAbi("ERC20"), syntheticTokenAddress);

  const shareHolderPayout = await _calculatePayoutsBetweenBlocks(
    uniswapPool,
    empContract,
    syntheticToken,
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
    empAddress,
    syntheticTokenAddress,
    blocksPerSnapshot,
    umaPerWeek
  );
}

// Calculate the payout to a list of `shareHolders` between `fromBlock` and `toBlock`. Split the block window up into
// chunks of `blockPerSnapshot` and at each chunk assign `umaPerSnapshot` at a prorata basis.
async function _calculatePayoutsBetweenBlocks(
  uniswapPool,
  empContract,
  syntheticToken,
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
    { format: "[{bar}] {percentage}% | snapshots traversed: {value}/{total}" },
    cliProgress.Presets.shades_classic
  );
  progressBar.start(snapshotsToTake, 0);
  for (let currentBlock = fromBlock; currentBlock < toBlock; currentBlock += blocksPerSnapshot) {
    shareHolderPayout = await _updatePayoutAtBlock(
      uniswapPool,
      empContract,
      syntheticToken,
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
// payouts for a given `uniswapPool` at a rate of `umaPerSnapshot`.
async function _updatePayoutAtBlock(
  uniswapPool,
  empContract,
  syntheticToken,
  blockNumber,
  shareHolderPayout,
  umaPerSnapshot
) {
  // Get the total supply of Uniswap Pool tokens at the given snapshot's block number.
  const lpTokenSupplyAtSnapshot = toBN(await uniswapPool.methods.totalSupply().call(undefined, blockNumber));

  // Get the total number of synthetics in the Uniswap pool at the snapshot's block number.
  const syntheticsInPoolAtSnapshot = toBN(
    await syntheticToken.methods.balanceOf(uniswapPool._address).call(undefined, blockNumber)
  );

  // Compute how many synthetics each LP token is redeemable for at the current pool weighting.
  const lpTokensToSynthetics = syntheticsInPoolAtSnapshot.mul(toBN(toWei("1"))).div(lpTokenSupplyAtSnapshot);

  // Get the given holders balance at the given block. Generate an array of promises to resolve in parallel.
  const uniswapBalanceResults = await Promise.map(
    Object.keys(shareHolderPayout),
    (shareHolder) => uniswapPool.methods.balanceOf(shareHolder).call(undefined, blockNumber),
    {
      concurrency: 50, // Keep infura happy about the number of incoming requests.
    }
  );

  // Also, get the position information for all shareholders.
  const tokenShareHolderPositionResults = await Promise.map(
    Object.keys(shareHolderPayout),
    (shareHolder) => empContract.methods.positions(shareHolder).call(undefined, blockNumber),
    {
      concurrency: 50, // Keep infura happy about the number of incoming requests.
    }
  );

  // For each balance result, calculate their associated payment addition. The data structures below are used to store
  // and compute the "effective" balance. this is the minimum of the token sponsors sponsor position OR redeemable
  // synths from their LP position.
  let shareHolderEffectiveSnapshotBalance = {};
  let cumulativeEffectiveSnapshotBalance = toBN("0");
  uniswapBalanceResults.forEach(function (uniswapResult, index) {
    // If the given shareholder had no BLP tokens at the given block, skip them.
    if (uniswapResult === "0") return;
    // The holders fraction is the number of BPTs at the block divided by the total supply at that block.
    const shareHolderLpBalanceAtSnapshot = toBN(uniswapResult);

    // Calculate how many synths the sponsors LP tokens are redeemable for at this given snapshot.
    const shareHolderRedeemableSynthsFromLpShareAtSnapshot = shareHolderLpBalanceAtSnapshot
      .mul(lpTokensToSynthetics)
      .div(toBN("1"));

    // Calculate how many synths the sponsors has created at the current snapshot.
    const shareHolderShareHolderSynthsOutstandingAtSnapshot = toBN(
      tokenShareHolderPositionResults[index].tokensOutstanding.rawValue
    );

    // The sponsors "effective" balance is the min of these two numbers.
    const minEffectiveSynthBalance = web3.utils.BN.min(
      shareHolderRedeemableSynthsFromLpShareAtSnapshot,
      shareHolderShareHolderSynthsOutstandingAtSnapshot
    );

    // Store this effective balance for computation.
    const shareHolderAddress = Object.keys(shareHolderPayout)[index];
    shareHolderEffectiveSnapshotBalance[shareHolderAddress] = minEffectiveSynthBalance;
    // Also, store the cumulative effective balance across all sponsors for the current snapshot. This is used next to
    // find the pro-rata distribution over this effective snapshot balance.
    cumulativeEffectiveSnapshotBalance = cumulativeEffectiveSnapshotBalance.add(minEffectiveSynthBalance);
  });

  // At this point we know each sponsors effective balance and the overall cumulative effective balance at the current
  // snapshot. Using this, we can compute how much each sponsor contributed to the overall effective balance and
  // allocate rewards accordingly.
  Object.keys(shareHolderEffectiveSnapshotBalance).forEach((shareHolderAddress) => {
    const shareHolderFractionAtSnapshot = toBN(toWei("1"))
      .mul(shareHolderEffectiveSnapshotBalance[shareHolderAddress])
      .div(cumulativeEffectiveSnapshotBalance);

    // The payout at the snapshot for the holder is their pro-rata fraction of per-snapshot rewards.
    const shareHolderPayoutAtSnapshot = shareHolderFractionAtSnapshot.mul(toBN(umaPerSnapshot)).div(toBN(toWei("1")));

    // Lastly, update the payout object for the given shareholder. This is their previous payout value + their new payout.
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
  empAddress,
  syntheticTokenAddress,
  blocksPerSnapshot,
  umaPerWeek
) {
  // First, clean the shareHolderPayout of all zero recipients and convert from wei scaled number.
  for (let shareHolder of Object.keys(shareHolderPayout)) {
    if (shareHolderPayout[shareHolder].toString() == "0") delete shareHolderPayout[shareHolder];
    else shareHolderPayout[shareHolder] = fromWei(shareHolderPayout[shareHolder]);
  }

  // Format output and save to file.
  const outputObject = {
    week,
    fromBlock,
    toBlock,
    poolAddress,
    empAddress,
    syntheticTokenAddress,
    blocksPerSnapshot,
    umaPerWeek,
    shareHolderPayout,
  };
  const savePath = `${path.resolve(__dirname)}/${tokenName}-weekly-payouts/Week_${week}_Mining_Rewards.json`;
  fs.writeFileSync(savePath, JSON.stringify(outputObject));
  console.log("🗄  File successfully written to", savePath);
}

// Find information about a given Uniswap `poolAddress` `shares` returns a list of all historic LP providers.
async function _fetchUniswapPoolInfo(poolAddress) {
  const SUBGRAPH_URL = process.env.SUBGRAPH_URL || "https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v2";
  const query = `
  {
    liquidityPositions (where:{pair:"${poolAddress.toLowerCase()}"} ) {
      user {
        id
      }
    }
  }   
    `;

  const response = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const data = (await response.json()).data;
  if (data.liquidityPositions.length > 0) {
    return data.liquidityPositions;
  }
  throw "⚠️  Uniswap pool provided is not indexed in the subgraph or bad address!";
}

// Implement async callback to enable the script to be run by truffle or node.
async function Main(callback) {
  try {
    // Pull the parameters from process arguments. Specifying them like this lets tests add its own.
    await calculateUniswapLPRewards(
      argv.fromBlock,
      argv.toBlock,
      argv.tokenName,
      argv.poolAddress,
      argv.empAddress,
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
Main.calculateUniswapLPRewards = calculateUniswapLPRewards;
Main._calculatePayoutsBetweenBlocks = _calculatePayoutsBetweenBlocks;
Main._updatePayoutAtBlock = _updatePayoutAtBlock;
Main._saveShareHolderPayout = _saveShareHolderPayout;
Main._fetchUniswapPoolInfo = _fetchUniswapPoolInfo;
module.exports = Main;
