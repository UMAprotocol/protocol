// This is an example file for how to run deployer rewards.  Use this as template to adjust parameters for your own run
// example: node apps/DeployerRewards ./config.example.js >> output.json
const moment = require("moment");

// emps to look at
const empWhitelist = ["0xaBBee9fC7a882499162323EEB7BF6614193312e3", "0x3605Ec11BA7bD208501cbb24cd890bC58D2dbA56"];

// start time and endtime in ms timestamp
const startTime = moment("9/20/2020 23:00:00", "MM/DD/YYYY  HH:mm z").valueOf(); // utc timestamp
const endTime = moment("10/19/2020 23:00:00", "MM/DD/YYYY HH:mm z").valueOf();

// 100 rewards to split across all emp creators
const totalRewards = (100n * 10n ** 18n).toString();

// network 1 = mainnet, 42 = kovan, will default to 1 if not specified
const network = 1;

module.exports = {
  empWhitelist,
  startTime,
  endTime,
  totalRewards,
  network
};
