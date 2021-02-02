const lodash = require('lodash')
const Promise = require('bluebird')
const fs = require('fs')
const moment = require('moment')
const Path = require('path') 

const { getWeb3 } = require("@uma/common");
const { getAbi } = require("@uma/core");
const { BigQuery } = require("@google-cloud/bigquery");

const Config = require("../libs/config");
const { DappMining } = require("../libs/affiliates");
const Queries = require("../libs/bigquery");

// This is the main function which configures all data sources for the calculation.
async function App(configs) {
  const web3 = getWeb3();

  const empAbi = getAbi("ExpiringMultiParty");
  const client = new BigQuery();
  const queries = Queries({ client });

  const dappmining = DappMining({ empAbi, queries, web3 });
  configs = lodash.castArray(configs)

  return Promise.map(configs,async config=>{
    const result = await dappmining.getRewards(config)
    const fn = makeFilename(config)
    return saveToDisk(fn,{config,...result})
  })
}

function makeFilename(config){
  const {startTime,endTime,name,weekNumber} = config
  const format = 'YYYY-MM-DD'
  const fn = [moment(startTime).format(format),moment(endTime).format(format),name,weekNumber.toString().padStart(4,'0'),].join('_')
  return [fn,'json'].join('.')
}

async function saveToDisk(fn,result){
  console.log(fn)
  fs.writeFileSync(Path.join(process.cwd(),fn),JSON.stringify(result,null,2))
  return result
}

const config = Config();

App(config)
  .then(x => console.log(JSON.stringify(x, null, 2)))
  .catch(console.error)
  // Process hangs if not forcibly closed. Unknown how to disconnect web3 or bigquery client.
  .finally(() => process.exit());

