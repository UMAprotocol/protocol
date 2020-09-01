// This script joins LM payout outputs between weekly payouts and a roll payout to create one output file. This should
// be run after generating the payout file for one week's LM and the roll LM. Effectively this script acts to create
// one unified shareHolderPayout that contains the sum of the weekly payouts and the roll payout. Additionally, this
// script adds additional meta data to the output file such as the roll num & array of pool addresses used in the roll.

// This script can be run as follows to join the outputs from week5 LM and the rollNum 1 outputs for yusdeth
// node ./packages/core/scripts/liquidity-mining/JoinRolledPayouts.js --week 5 --rollNum 1 --tokenName yusdeth

const fs = require("fs");
const path = require("path");
const Web3 = require("web3");

const web3 = new Web3(new Web3.providers.HttpProvider(process.env.CUSTOM_NODE_URL));
const { toWei, toBN, fromWei } = web3.utils;

const argv = require("minimist")(process.argv.slice(), {
  integer: ["week", "rollNum"],
  string: ["tokenName"]
});

async function JoinRolledPayouts(week, rollNum, tokenName) {
  if (!week || !rollNum || !tokenName) {
    throw new Error("Missing or invalid parameter! Provide week, rollNum & tokenName");
  }

  console.log(`🧶 Joining LM payouts between week ${week} and roll # ${rollNum} for ${tokenName}`);

  // Read in the weekly rewards. This file contains the post roll weekly rewards.
  const weeklyRewardsRaw = fs.readFileSync(
    `${path.resolve(__dirname)}/${tokenName}-weekly-payouts/Week_${week}_Mining_Rewards.json`
  );
  const weeklyRewards = JSON.parse(weeklyRewardsRaw);

  // Read in the roll rewards. This file contains the rewards calculated over the two pools during the roll.
  const rollRewardsRaw = fs.readFileSync(
    `${path.resolve(__dirname)}/${tokenName}-weekly-payouts/expiring-contract-rolls/Roll_${rollNum}_Mining_Rewards.json`
  );
  const rollRewards = JSON.parse(rollRewardsRaw);

  // Sanity check: for the pool inputs to be valid, the second pool in the roll should be the weekly rewards pool.
  // We are rolling from pool1Address into pool2Address and so we should end up in pool2Address from the weekly rewards.
  if (rollRewards.pool2Address != weeklyRewards.poolAddress)
    throw "The second rolled pool address must equal the incoming weekly rewards pool";

  const joinedPayouts = _joinPayouts(weeklyRewards, rollRewards);

  console.log("👉👈 Successfully joined payouts");

  const savePath = `${path.resolve(__dirname)}/${tokenName}-weekly-payouts/Week_${week}_Mining_Rewards.json`;
  fs.writeFileSync(savePath, JSON.stringify(joinedPayouts));
  console.log("🗄  File successfully written to", savePath);
}

// Take in a weeklyRewards object and a rollRewards object and return a joined payouts object with summed shareHolderPayout.
// Appends additional information to the output to, such as the original value for shareHolderPayout for the weekly input.
function _joinPayouts(weeklyRewards, rollRewards) {
  // Take the weeklyRewards data to start with. Cast to back and forth with JSON to create a deep copy.
  let outputData = JSON.parse(JSON.stringify(weeklyRewards));

  // Append useful data to the output.
  outputData.poolAddress = [rollRewards.pool1Address, rollRewards.pool2Address];
  outputData.rollNum = rollRewards.rollNum;
  outputData.endRollBlock = rollRewards.toBlock; // the end roll block num is the where the roll rolled `to`
  outputData.fromBlock = rollRewards.fromBlock; // the starting block num for the overall output is the roll data `from`.
  // Note that the `outputData.toBlock` is preserved from the weeklyRewards object.
  // Store the original weeklyRewards in a key `weeklyShareHolderPayoutBeforeRollJoin` for prosperity.
  outputData.weeklyShareHolderPayoutBeforeRollJoin = JSON.parse(JSON.stringify(weeklyRewards.shareHolderPayout));
  outputData.umaPerWeek = weeklyRewards.umaPerWeek + rollRewards.umaPerWeek;
  // Next, iterate over all shareholders in the shareholders in the rollRewards and if they are present in the weeklyRewards
  // then add their balances together. If they are not present in the weeklyRewards then their balance stays the same.
  // Note that if a shareholder is only in weeklyRewards (not rollRewards) then they are not iterated over in this loop.
  // This is fine as their balance is preserved from the original copy of weeklyRewards into outputData.
  Object.entries(rollRewards.shareHolderPayout).forEach(shareHolder => {
    const rollShareHolderAddr = shareHolder[0];
    const rollShareHolderRewards = toBN(toWei(shareHolder[1]));
    // If the address was already in the weeklyRewards then add their previous balance to the rolled ballance.
    if (weeklyRewards.shareHolderPayout[rollShareHolderAddr]) {
      const weeklyShareholderRewards = toBN(toWei(weeklyRewards.shareHolderPayout[rollShareHolderAddr]));
      outputData.shareHolderPayout[rollShareHolderAddr] = fromWei(weeklyShareholderRewards.add(rollShareHolderRewards));
    }
    // Else their balance should simply be the rolled ballance.
    else outputData.shareHolderPayout[rollShareHolderAddr] = fromWei(rollShareHolderRewards);
  });
  return outputData;
}

// Implement async callback to enable the script to be run by truffle or node.
async function Main(callback) {
  try {
    await JoinRolledPayouts(argv.week, argv.rollNum, argv.tokenName);
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

Main.JoinRolledPayouts = JoinRolledPayouts;
Main._joinPayouts = _joinPayouts;
module.exports = Main;
