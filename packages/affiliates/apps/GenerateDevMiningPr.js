require("dotenv").config();
const { makeUnixPipe, devMiningPrTemplate } = require("../libs/affiliates/utils");

// This expects to be piped json input which contains this structure:
// {
//   "issueNumber": 2620,
//   "config": {
//     "weekNumber": 16,
//     "endDate": "03/01/2021 11:00 PM",
//     "startDate": "02/22/2021 11:00 PM",
//     "startTime": 1614034800000,
//     "endTime": 1614639600000,
//     "empWhitelist": [
//       [
//         "0xeFA41F506EAA5c24666d4eE40888bA18FA60a1c7",
//         "0xbca9B2e6B6620197aBA4fdb59079d3FeE21c361E"
//       ]
//     ],
//     "fallbackPrices": [],
//     "totalRewards": 50000
//   },
// }
// To run:
// cat param.json | node apps/GenerateDevMiningPr
//
// This will output:
// {
//   prTemplate:{
//     title:'PR title string',
//     body: 'Pr body',
//   }
// }
const App = async params => {
  const input = { ...params, ...params.config };
  const prTemplate = devMiningPrTemplate(input);
  return {
    prTemplate,
    ...params
  };
};

makeUnixPipe(App)
  .then(console.log)
  .catch(console.error);
