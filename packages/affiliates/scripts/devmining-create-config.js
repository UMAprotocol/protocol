require('dotenv').config()
const highland = require('highland')
const moment = require('moment')
const { Octokit } = require("@octokit/rest");

function whitelistFromDetails(details){
  return details.map(detail=>{
    return [detail.empAddress,detail.payoutAddress]
  })
}
function generateFullConfig(details){
  const startTime=moment("2021-02-01 23:00", "YYYY-MM-DD  HH:mm Z").valueOf()
  const endTime=moment(startTime).add(7,'days').valueOf()
  const empWhitelist = whitelistFromDetails(details)
  const fallbackPrices =[
    ["0xeAddB6AD65dcA45aC3bB32f88324897270DA0387",'1'],
    ["0xf215778f3a5e7ab6a832e71d87267dd9a9ab0037",'1'],
    ["0x267D46e71764ABaa5a0dD45260f95D9c8d5b8195",'1'],
    ["0x2862a798b3defc1c24b9c0d241beaf044c45e585",'1'],
    ["0xd81028a6fbaaaf604316f330b20d24bfbfd14478",'1'],
  ]
  const totalRewards = '50000'
  const network = 1;
  return {
    startTime,
    endTime,
    empWhitelist,
    fallbackPrices,
    totalRewards,
    network,
  }
}

highland(process.stdin)
  .reduce('',(result,str)=>{
    return result + str
  })
  .map(x=>JSON.parse(x))
  .map(generateFullConfig)
  .each(result=>{
    console.log(JSON.stringify(result,null,2))
  })


