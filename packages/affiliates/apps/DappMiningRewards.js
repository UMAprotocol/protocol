require("dotenv").config();
const assert = require("assert");
const { getWeb3 } = require("@uma/common");
const { getAbi } = require("@uma/core");
const { BigQuery } = require("@google-cloud/bigquery");

const { DappMining } = require("../libs/affiliates");
const Queries = require("../libs/bigquery");
const { makeUnixPipe } = require("../libs/affiliates/utils");

// This is the main function which configures all data sources for the calculation.
// params is expected to be a json object with the following shape:
// {
// "config": {
//   "name": "YD-ETH-MAR21",
//   "empAddress": "0xE4256C47a3b27a969F25de8BEf44eCA5F2552bD5",
//   "rewardFactor": 0.3,
//   "defaultAddress": "0xa0dfF1F09a0DCEda7641b7eB07c3BDbe66a06C35",
//   "whitelistTable": [
//     [
//       "UMA (default)",
//       "0xa0dfF1F09a0DCEda7641b7eB07c3BDbe66a06C35"
//     ],
//     [
//       "OpenDAO",
//       "0x9a9dcd6b52B45a78CD13b395723c245dAbFbAb71"
//     ],
//     [
//       "MakeShift Finance",
//       "0x45Ea614a7Ea47Ec393BDA310F901702DB1347df9"
//     ],
//     [
//       "ChickFlock",
//       "0xDAa953f01048253A201BA9B0bd0786575f9C2468"
//     ]
//   ],
//   "empRewards": "17809.92065430851969227",
//   "weekNumber": 7,
//   "endDate": "03/01/2021 11:00 PM",
//   "startDate": "02/22/2021 11:00 PM",
//   "startTime": 1614034800000,
//   "endTime": 1614639600000,
//   "totalRewards": 5342,
//   "whitelist": [
//     "0xa0dfF1F09a0DCEda7641b7eB07c3BDbe66a06C35",
//     "0x9a9dcd6b52B45a78CD13b395723c245dAbFbAb71",
//     "0x45Ea614a7Ea47Ec393BDA310F901702DB1347df9",
//     "0xDAa953f01048253A201BA9B0bd0786575f9C2468"
//   ]
// }
// This config can be generated through the apps/GenerateDappMiningConfig
const App = async params => {
  const { config } = params;
  const web3 = getWeb3();
  const { version = "v2" } = config;
  assert(
    DappMining[version],
    "Invalid version in dappmining config, must be one of: " + Object.keys(DappMining).join(", ")
  );

  const empAbi = getAbi("ExpiringMultiParty", "1.2.2");
  const client = new BigQuery();
  const queries = Queries({ client });

  const dappmining = DappMining[version]({ empAbi, queries, web3 });
  const result = await dappmining.getRewards(config);

  return {
    ...params,
    result
  };
};

makeUnixPipe(App)
  .then(console.log)
  .catch(console.error)
  .finally(() => process.exit());
