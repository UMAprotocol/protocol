require('dotenv').config()
const moment = require('moment')
const { Octokit } = require("@octokit/rest");

const octokit = new Octokit({
  auth: process.env.github,
});

function eslink(addr){
  return `https://etherscan.io/address/${addr}`
}
function devminingTemplate({contractName,contractAddress,startTime,endTime, whitelist}){
    const startDate = moment(startTime).utc().format('YYYY/MM/DD')
    const endDate = moment(endTime).utc().format('YYYY/MM/DD')
    const startDateTime = moment(startTime).format('YYYY/MM/DD HH:mm')
    const endDateTime = moment(endTime).format('YYYY/MM/DD HH:mm')
    return {
      title:`Run Dapp Mining rewards for ${contractName} between ${startDate} and ${endDate}`,
      body:
`
Run dapp mining rewards for [${contractName}](${eslink(contractAddress)}) from ${startDateTime} (${startTime}) to ${endDateTime} (${endTime}).

Use whitelisted addresses:
${whitelist.map(addr=>{
  return `  - [${addr}](${eslink(addr)})`
}).join('\n')}
`
    }
  },
}

async function rungh(config){
  const { data } = await octokit.request("/user");
  console.log(data)
  octokit.issues.create({
    owner:'UMAprotocol',
    repo:'protocol',
    ...templates.dappmining(config)
  })
}

const config = {
  contractName:'YD-ETH-MAR21',
  contractAddress:'0xE4256C47a3b27a969F25de8BEf44eCA5F2552bD5',
  whitelist:[
    '0xa0dfF1F09a0DCEda7641b7eB07c3BDbe66a06C35',
    '0x9a9dcd6b52B45a78CD13b395723c245dAbFbAb71',
  ],
  startTime:moment("2021-01-18 23:00", "YYYY-MM-DD  HH:mm Z").valueOf(),
  endTime:moment("2021-01-18 23:00", "YYYY-MM-DD  HH:mm Z").add(7,'days').valueOf(),
}
// const config = {
//   contractName:'YD-BTC-MAR21',
//   contractAddress:'0x1c3f1A342c8D9591D9759220d114C685FD1cF6b8',
//   whitelist:[
//     '0x9a9dcd6b52B45a78CD13b395723c245dAbFbAb71',
//     '0xa0dfF1F09a0DCEda7641b7eB07c3BDbe66a06C35',
//   ],
//   startTime:moment("2021-01-18 23:00", "YYYY-MM-DD  HH:mm Z").valueOf(),
//   endTime:moment("2021-01-18 23:00", "YYYY-MM-DD  HH:mm Z").add(7,'days').valueOf(),
// }

console.log(templates.dappmining(config))
rungh(config).then(x=>console.log('done')).catch(console.log)

