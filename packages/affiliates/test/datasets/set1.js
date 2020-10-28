// exports the parameters used to generate the dataset
// use this in scripts that start with "write-" to generate a dateset
const moment = require("moment");
const empCreator = "0x9A077D4fCf7B26a0514Baa4cff0B481e9c35CE87";
const empContracts = ["0xaBBee9fC7a882499162323EEB7BF6614193312e3", "0x3605Ec11BA7bD208501cbb24cd890bC58D2dbA56"];
const syntheticTokens = ["0xF06DdacF71e2992E2122A1a0168C6967aFdf63ce", "0xD16c79c8A39D44B2F3eB45D2019cd6A42B03E2A9"];
const syntheticTokenDecimals = [18, 18];

const startingBlock = 11043617;
const startingTimestamp = moment("9/20/2020 23:00:00", "MM/DD/YYYY  HH:mm z").valueOf(); // utc timestamp

const endingBlock = 11089341;
const endingTimestamp = moment("10/19/2020 23:00:00", "MM/DD/YYYY HH:mm z").valueOf();

module.exports = {
  // this is the sub directory name
  name: "set1",
  // all other params to generate data set and use in tests
  empCreator,
  empContracts,
  syntheticTokens,
  syntheticTokenDecimals,
  startingBlock,
  startingTimestamp,
  endingBlock,
  endingTimestamp
};
