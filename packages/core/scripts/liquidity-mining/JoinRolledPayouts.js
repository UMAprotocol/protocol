const fs = require("fs");
const path = require("path");
const Web3 = require("web3");

const web3 = new Web3(new Web3.providers.HttpProvider(process.env.CUSTOM_NODE_URL));
const { toWei, toBN, fromWei, isAddress } = web3.utils;

const argv = require("minimist")(process.argv.slice(), {
  integer: ["weekNum", "rollNum"],
  string: ["tokenName"]
});

async function joinRolledPayouts(weekNum, rollNum, tokenName) {
  if (!weekNum || !rollNum || !tokenName) {
    throw "Missing or invalid parameter! Provide weekNum, rollNum & tokenName";
  }

  const weeklyRewardsRaw = fs.readFileSync(
    `${path.resolve(__dirname)}/${tokenName}-weekly-payouts/Week_${weekNum}_Mining_Rewards.json`
  );
  const weeklyRewards = JSON.parse(weeklyRewardsRaw);

  const rollDataRaw = fs.readFileSync(
    `${path.resolve(__dirname)}/${tokenName}-weekly-payouts/expiring-contract-rolls/Roll_${rollNum}_Mining_Rewards.json`
  );
  const rollData = JSON.parse(rollDataRaw);

  //   if (rollData.pool2Address != weeklyRewards.poolAddress)
  //     throw "The second rolled pool address must equal the incoming weekly rewards pool";

  // Take the weeklyRewards data to start with
  let outputData = weeklyRewards;

  outputData.poolAddress = [rollData.pool1Address, rollData.pool2Address];
  outputData.rollNum = rollData.rollNum;
  Object.entries(rollData.shareHolderPayout).forEach(shareHolder => {
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

  outputData.preRollWeeklyJoinPayout = weeklyRewards.shareHolderPayout;
  console.log("outputData", outputData);

  const savePath = `${path.resolve(__dirname)}/${tokenName}-weekly-payouts/Week_${weekNum}_Mining_Rewards.json`;
  fs.writeFileSync(savePath, JSON.stringify(outputData));
  console.log("🗄  File successfully written to", savePath);
}

// Implement async callback to enable the script to be run by truffle or node.
async function Main(callback) {
  try {
    await joinRolledPayouts(argv.weekNum, argv.rollNum, argv.tokenName);
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

Main.joinRolledPayouts = joinRolledPayouts;
module.exports = Main;
