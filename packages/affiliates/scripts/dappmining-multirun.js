const moment = require('moment')
function periodFromWeek(weekNumber=0,first=moment("2021-01-04 23:00", "YYYY-MM-DD  HH:mm Z").valueOf()){
  return {
    weekNumber,
    startTime:moment(first).add(weekNumber,'weeks').valueOf(),
    endTime:moment(first).add(weekNumber + 1,'weeks').valueOf(),
  }
}

const weekNumber = 3
const period = periodFromWeek(weekNumber)
const configs = [
  {
    contractName:'YD-ETH-MAR21',
    contractAddress:'0xE4256C47a3b27a969F25de8BEf44eCA5F2552bD5',
    whitelist:[
      '0xa0dfF1F09a0DCEda7641b7eB07c3BDbe66a06C35',
      '0x9a9dcd6b52B45a78CD13b395723c245dAbFbAb71',
    ],
    ...period,
  },
  {
    contractName:'YD-BTC-MAR21',
    contractAddress:'0x1c3f1A342c8D9591D9759220d114C685FD1cF6b8',
    whitelist:[
      '0x9a9dcd6b52B45a78CD13b395723c245dAbFbAb71',
      '0xa0dfF1F09a0DCEda7641b7eB07c3BDbe66a06C35',
    ],
    ...period,
  }

]
module.exports = configs
