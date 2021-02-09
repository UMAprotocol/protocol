require('dotenv').config()
const highland = require('highland')
const moment = require('moment')
const { Octokit } = require("@octokit/rest");

const octokit = new Octokit({
  auth: process.env.github,
});

function eslink(addr){
  return `https://etherscan.io/address/${addr}`
}
function mdlink(text,link){
  return `[${text}](${link})`
}
function devMiningTemplate({empWhitelist,startTime,endTime,totalRewards,fallbackPrices,details}){
    const startDate = moment(startTime).utc().format('YYYY/MM/DD')
    const endDate = moment(endTime).utc().format('YYYY/MM/DD')
    const startDateTime = moment(startTime).format('YYYY/MM/DD HH:mm')
    const endDateTime = moment(endTime).format('YYYY/MM/DD HH:mm')
    return {
      title:`Run Dev Mining rewards between ${startDate} and ${endDate}`,
      body:
`
Run Dev Mining rewards between ${startDate} and ${endDate}.

 
Contract Name | EMP Address | Payout Address
-- | -- | --
${details.map(data=>{
  return [data.name,mdlink(data.empAddress,eslink(data.empAddress)),data.payoutAddress]
    .join(' | ')
}).join('\n')}

We will be forcing several contracts to a default price due to lack of consistent price feeds:
${fallbackPrices.map(pair=>{
  return '  - ' + mdlink(pair[0],eslink(pair[0])) + ' = ' + '$' + pair[1]
}).join('\n')}
`

    }

}

async function rungh(markdown){
  const { data } = await octokit.request("/user");
  return octokit.issues.create({
    owner:'UMAprotocol',
    repo:'protocol',
    ...markdown,
  })
}

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
function generateMarkdownConfig(details){
  return {
    details,
    ...generateFullConfig(details),
  }
}

highland(process.stdin)
  .reduce('',(result,str)=>{
    return result + str
  })
  .map(x=>JSON.parse(x))
  .map(generateMarkdownConfig)
  .map(devMiningTemplate)
  .map(rungh)
  .flatMap(highland)
  .each(result=>{
    console.log(result)
  })


