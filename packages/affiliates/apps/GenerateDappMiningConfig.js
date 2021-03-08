const assert = require("assert");
const Config = require("../libs/config");
const { generateDappMiningConfig, makeUnixPipe } = require("../libs/affiliates/utils");

// This is the main function which configures all data sources for the calculation.
// This expects 2 inputs to be able to run. A piped JSON object of the following shape:
// {
//   "empPayouts": {
//     "0xaB3Aa2768Ba6c5876B2552a6F9b70E54aa256175": "4.642127253577904278",
//     "0x3a93E863cb3adc5910E6cea4d51f132E8666654F": "169.713891697649473471",
//     "0x1c3f1A342c8D9591D9759220d114C685FD1cF6b8": "13575.393688179154686177",
//     "0xE4256C47a3b27a969F25de8BEf44eCA5F2552bD5": "17809.92065430851969227",
//     "0xeAddB6AD65dcA45aC3bB32f88324897270DA0387": "4451.86601721495242671",
//     "0xf215778F3a5e7Ab6A832e71d87267Dd9a9aB0037": "4311.371362769016568672",
//     "0x267D46e71764ABaa5a0dD45260f95D9c8d5b8195": "6.477376623061279144",
//     "0x2862A798B3DeFc1C24b9c0d241BEaF044C45E585": "837.071500503383154938",
//     "0xd81028a6fbAAaf604316F330b20D24bFbFd14478": "202.254830551628699995",
//     "0x7c4090170aeADD54B1a0DbAC2C8D08719220A435": "5086.388302954326475232",
//     "0xaD3cceebeFfCdC3576dE56811d0A6D164BF9A5A1": "2317.170590760206911925",
//     "0xC843538d70ee5d28C5A80A75bb94C28925bB1cf2": "155.806699098873554393",
//     "0xeFA41F506EAA5c24666d4eE40888bA18FA60a1c7": "180.725593486514928413",
//     "0xEAA081a9fad4607CdF046fEA7D4BF3DfEf533282": "516.169255347878456515",
//     "0xfA3AA7EE08399A4cE0B4921c85AB7D645Ccac669": "375.028109251255036667"
//   }
// }
// And a config file to be included as a command line argument with data like this:
// {
//   name:'YD-ETH-MAR21',
//   empAddress:'0xE4256C47a3b27a969F25de8BEf44eCA5F2552bD5',
//   rewardFactor:.3,
//   defaultAddress:'0xa0dfF1F09a0DCEda7641b7eB07c3BDbe66a06C35',
//   whitelistTable:[
//     ['UMA (default)','0xa0dfF1F09a0DCEda7641b7eB07c3BDbe66a06C35'],
//     ['OpenDAO','0x9a9dcd6b52B45a78CD13b395723c245dAbFbAb71'],
//     ['MakeShift Finance','0x45Ea614a7Ea47Ec393BDA310F901702DB1347df9'],
//     ['ChickFlock','0xDAa953f01048253A201BA9B0bd0786575f9C2468']
//   ]
// }
// Run the app like this: cat rewards.json | node app/GenerateDappMiningConfig config.json
const App = params => devMiningOutput => {
  const empRewards = devMiningOutput.empPayouts[params.empAddress];
  assert(empRewards, "emp rewards not found in dev mining output for: " + params.empAddress);
  const config = generateDappMiningConfig({ ...params, empRewards });
  return {
    params,
    config
  };
};

const config = Config();

makeUnixPipe(App(config))
  .then(console.log)
  .catch(console.error);
