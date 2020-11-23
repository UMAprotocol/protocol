// exports the parameters used to generate the dataset. Copy this and edit to make your own dataset
// see apps/CreateDataset or run with node apps/CreateDataset createdataset.example.js --network=mainnet_mnemonic
const moment = require("moment");
const empCreator = "0x9A077D4fCf7B26a0514Baa4cff0B481e9c35CE87";

const empContracts = [
  "0xaBBee9fC7a882499162323EEB7BF6614193312e3", // uUSDrBTC-DEC
  "0x3605Ec11BA7bD208501cbb24cd890bC58D2dbA56", // uUSDrWETH-DEC
  "0x306B19502c833C1522Fbc36C9dd7531Eda35862B" // pxUSD-OCT2020
];

const collateralTokens = [
  "0xEB4C2781e4ebA804CE9a9803C67d0893436bB27D", // rBTC
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", // wETH
  "0xeca82185adce47f39c684352b0439f030f860318" // PERL
];

const syntheticTokenDecimals = [18, 18, 18];

const collateralTokenDecimals = [8, 18, 18];

const startingTimestamp = moment("2020-09-23 23:00:00", "YYYY-MM-DD  HH:mm Z").valueOf(); // utc timestamp

const endingTimestamp = moment("2020-10-05 23:00:00", "YYYY-MM-DD  HH:mm Z").valueOf();

module.exports = {
  // this is the sub directory name
  name: "set1",
  // all other params to generate data set and use in tests
  empCreator,
  empContracts,
  collateralTokens,
  collateralTokenDecimals,
  syntheticTokenDecimals,
  startingTimestamp,
  endingTimestamp,
  start: startingTimestamp,
  end: endingTimestamp
};
