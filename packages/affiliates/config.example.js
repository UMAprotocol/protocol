// This is an example file for how to run deployer rewards.  Use this as template to adjust parameters for your own run
// example: node apps/DeployerRewards ./config.example.js >> output.json
const moment = require("moment");

// emps to look at
const empWhitelist = [
  "0xaBBee9fC7a882499162323EEB7BF6614193312e3",
  "0x3605Ec11BA7bD208501cbb24cd890bC58D2dbA56",
  "0x306B19502c833C1522Fbc36C9dd7531Eda35862B"
];

// start time and endtime in ms timestamp
const startTime = moment("2020-9-23 23:00:00", "YYYY-MM-DD  HH:mm Z").valueOf(); // utc timestamp
const endTime = moment("2020-10-05 23:00:00", "YYYY-MM-DD  HH:mm Z").valueOf();

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
