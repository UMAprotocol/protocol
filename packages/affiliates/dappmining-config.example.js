const moment = require("moment");

// Emp to process rewards for: YD-ETH-MAR21
const empAddress = "0xE4256C47a3b27a969F25de8BEf44eCA5F2552bD5";

// Start of payout period
const startTime = moment("2020-12-10", "YYYY-MM-DD").valueOf();
// End of payout period
const endTime = moment("2020-12-28", "YYYY-MM-DD").valueOf();
// Total amount of rewards to payout for period
const totalRewards = 25000;

// Default reward address for emp create events which are untagged.
// This acts as the default Dapp developer address to payout rewards to if transactions are untagged.
const defaultAddress = "0xa0dfF1F09a0DCEda7641b7eB07c3BDbe66a06C35";

// Whitelisted reward addresses for tagged create events. Tagged events not whitelisted will be ignored.
// These are Dapp developer addresses that have been whitelisted to receive rewards.
const whitelist = ["0x9a9dcd6b52b45a78cd13b395723c245dabfbab71"];

module.exports = {
  // name is ignored when running the dapp rewards script, but is required to generate output for a dataset.
  name: "dapp-mining-set1",
  empAddress,
  startTime,
  endTime,
  totalRewards,
  whitelist,
  defaultAddress
};
