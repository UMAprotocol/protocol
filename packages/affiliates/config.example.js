// This is an example file for how to run deployer rewards.  Use this as template to adjust parameters for your own run
// example: node apps/DeployerRewards ./config.example.js >> output.json
const moment = require("moment");

const empWhitelist = [
  // [emp address, reward payout address]
  ["0xaBBee9fC7a882499162323EEB7BF6614193312e3", "0xa0dfF1F09a0DCEda7641b7eB07c3BDbe66a06C35"],
  ["0x3605Ec11BA7bD208501cbb24cd890bC58D2dbA56", "0xa0dfF1F09a0DCEda7641b7eB07c3BDbe66a06C35"],
  ["0x306B19502c833C1522Fbc36C9dd7531Eda35862B", "0x53911776641d6dF38B88b9eF27f920c617E3Cb5e"]
];

// start time and endtime in ms timestamp
const startTime = moment("2020-12-01 23:00:00", "YYYY-MM-DD  HH:mm Z").valueOf(); // utc timestamp
const endTime = moment("2020-12-07 23:00:00", "YYYY-MM-DD  HH:mm Z").valueOf();

// 10000 rewards to split across all emp creators
const totalRewards = 10000n.toString();

// network 1 = mainnet, 42 = kovan, will default to 1 if not specified
const network = 1;

module.exports = {
  empWhitelist,
  startTime,
  endTime,
  totalRewards,
  network
};
