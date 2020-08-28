const fs = require("fs");
const path = require("path");
const Web3 = require("web3");

const web3 = new Web3(new Web3.providers.HttpProvider(process.env.CUSTOM_NODE_URL));
const { toWei, toBN, fromWei, isAddress } = web3.utils;

const argv = require("minimist")(process.argv.slice(), {
  integer: ["weekNum", "rollNum"]
});

async function joinRolledPayouts(weekNum, rollNum) {
  const weeklyRewardsRaw = fs.readFileSync(
    `${path.resolve(__dirname)}/weekly-payouts/Week_${weekNum}_Mining_Rewards.json`
  );
  const weeklyRewards = JSON.parse(weeklyRewardsRaw);

  const rollDataRaw = fs.readFileSync(
    `${path.resolve(__dirname)}/weekly-payouts/contract-rolls/Expiring_Roll_${rollNum}_Mining_Rewards.json`
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

  console.log("outputData", outputData);
}

async function Main(callback) {
  try {
    await joinRolledPayouts(argv.weekNum, argv.rollNum);
  } catch (error) {
    console.error(error);
  }
  callback();
}

Main.joinRolledPayouts = joinRolledPayouts;
module.exports = Main;
