const fs = require("fs");
const path = require("path");
const Web3 = require("web3");

const web3 = new Web3(new Web3.providers.HttpProvider(process.env.CUSTOM_NODE_URL));
const { toWei, toBN, fromWei, isAddress } = web3.utils;

const argv = require("minimist")(process.argv.slice(), {
  integer: ["weekNum", "rollNum"]
});

async function joinRolledPayouts(weekNum, rollNum) {
  const rollDatRaw = fs.readFileSync(
    `${path.resolve(__dirname)}/weekly-payouts/contract-rolls/Expiring_Roll_${rollNum}_Mining_Rewards.json`
  );
  const rollData = JSON.parse(rollDatRaw);
  const weeklyRewardsRaw = fs.readFileSync(
    `${path.resolve(__dirname)}/weekly-payouts/contract-rolls/Expiring_Roll_${rollNum}_Mining_Rewards.json`
  );
  const weeklyRewards = JSON.parse(weeklyRewardsRaw);

  let outputData = weeklyRewards;
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
