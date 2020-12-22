const { BigQuery } = require("@google-cloud/bigquery");
const highland = require("highland");
const Queries = require("../libs/bigquery");
const moment = require("moment");
const { getAbi } = require("@uma/core");
const { DecodeTransaction, DecodeAttribution, GetInputLength, DecodeLog } = require("../libs/contracts");
const {EmpAttributions,EmpBalances}  = require('../libs/processors')
const Events = require('events')

// const contract = "0x3605Ec11BA7bD208501cbb24cd890bC58D2dbA56"
// const contract = "0xE4256C47a3b27a969F25de8BEf44eCA5F2552bD5"
const contract = "0xfa3aa7ee08399a4ce0b4921c85ab7d645ccac669"
// const contracts = [
//  "0x3605Ec11BA7bD208501cbb24cd890bC58D2dbA56",
//  "0xE4256C47a3b27a969F25de8BEf44eCA5F2552bD5",
//  "0xfa3aa7ee08399a4ce0b4921c85ab7d645ccac669",
// ]
const defaultReward = '0xa0dfF1F09a0DCEda7641b7eB07c3BDbe66a06C35'

const whitelist = [
  '0x97990b693835da58a281636296d2bf02787dea17',
  defaultReward,
]

const start = moment("2020-12-12", "YYYY-MM-DD").valueOf();
const end = moment("2020-12-25", "YYYY-MM-DD").valueOf();

const client = new BigQuery();
const queries = Queries({ client });
const empAbi = getAbi("ExpiringMultiParty");

function sumAttributions(attributions,blocksElapsed=1,sum=Attributions()){
  attributions.forEach((userid,developerid,amount)=>{
    const weighted = BigInt(value) * BigInt(blocksElapsed)
    sum.attribute(userid,developerid,weighted.toString())
  })
  return sum
}
function sumBalances(balances,blocksElapsed=1,sum=Balances()){
  balances.forEach((value,userid)=>{
    const weighted = BigInt(value) * BigInt(blocksElapsed)
    sum.deposit(userid,weighted.toString())
  })
  return sum
}

function calculateStats({
    attributions,
    balances,
    whitelist,
  },
  stats={}
){
}

// returns the proportion of rewards given to each developer for a specific point in time
function calculateBlockReward({
    attributions,
    balances,
    whitelist,
  },
  // return all tags with a percent value for rewards
  rewards={}
){
  // for every user with a token balance
  balances.keys().forEach(userid=>{
    // console.log('calculating',userid)
    // get their stake percent relative to all balances in emp
    const balancePercent = balances.getPercent(userid)
    console.log({balancePercent,balances:balances.snapshot(),attributions:attributions.snapshot()})
    // go through all whitelisted tags
    whitelist.forEach(tag=>{
      if(rewards[tag] == null) rewards[tag] = '0'
      // get that tags attribution percent for that user relative to all other affiliates
      const attributionPercent = attributions.calculateShare(userid,tag)
      console.log({tag,attributionPercent})
      // multiply the balance percent and the attribution percent to get final attribution weight
      // and add it to the rest of the weights. This will need to be divided by 1e18
      rewards[tag] = (BigInt(rewards[tag]) + BigInt(balancePercent) * BigInt(attributionPercent)).toString()
    })
  })
  console.log({rewards})
  return rewards
}

// function DappRewardProcessor(cb){
//   let block, event, attribution
//   let finalize = 0

//   function pullBlock(){
//     // console.log('pull block')
//     cb('pullBlock')
//   }
//   function pullEvent(){
//     cb('pullEvent')
//     if(event) console.log('pull event',event.blockNumber,block.number)
//   }
//   function pullAttribution(){
//     cb('pullAttribution')
//     if(attribution) console.log('pull attribution',attribution.blockNumber,block.number)
//   }
//   function runCalculation(){
//     // console.log('run calc')
//     cb('runCalculation',block.number)
//   }
//   function runFinalize(){
//     // console.log('run calc')
//     cb('runFinalize',block.number)
//   }

//   function tick(latestBlock=block,latestEvent=event,latestAttribution=attribution){
//     // case where block doesnt exist yet, do nothing
//     if(finalize === 3) return runFinalize()
//     if(latestBlock == null) return pullBlock()
//     if(latestEvent == null) return pullEvent()
//     if(latestAttribution == null) return pullAttribution()
//     // // we need to wait for more events to come in before doing anything
//     if(latestEvent.blockNumber < latestBlock.number) return pullEvent()
//     // // we need to wait for more transactions to come in before doing anything
//     if(latestAttribution.blockNumber < latestBlock.number) return pullAttribution()
//     // // now we have a block, and we have transactions and events up to or past the block
//     // // we can calculate the rewards and apply these to state
//     runCalculation()
//     pullBlock()
//   }

//   function processBlock(latestBlock){
//     block = latestBlock
//     tick()
//   }
//   function processEvent(latestEvent){
//     event = latestEvent
//     tick()
//   }
//   function processAttribution(latestAttribution){
//     attribution = latestAttribution
//     tick()
//   }

//   function endBlocks(){
//     console.log('ending block')
//     finalize ++
//     tick()
//   }
//   function endEvents(){
//     console.log('ending events')
//     finalize ++
//     tick()
//   }
//   function endAttributions(){
//     console.log('ending attributions')
//     finalize ++
//     tick()
//   }

//   return {
//     tick,
//     processAttribution,
//     processEvent,
//     processBlock,
//     endBlocks,
//     endEvents,
//     endAttributions,
//   }
// }

function getBlockStream(){
  const stream = queries.getBlockStream(start, end, ["timestamp", "number"]);
  return highland(stream)
    .map(block => {
      return {
        ...block,
        timestamp: moment(block.timestamp.value).valueOf()
      };
    });
}

function getEventStream(empAddress,start,end){
  const stream = queries.streamLogsByContract(empAddress, start, end);
  const decode = DecodeLog(empAbi);
  return highland(stream)
    .map(log => {
      return decode(log, {
        blockNumber: log.block_number,
        blockTimestamp: moment(log.block_timestamp.value).valueOf(),
        ...log
      });
    })
}

function getAttributionStream(empAddress, start, end) {
  // stream is a bit more optimal than waiting for entire query to return as array
  // We need all logs from beginning of time. This could be optimized by deducing or supplying
  // the specific emp start time to narrow down the query.
  const stream = queries.streamTransactionsByContract(empAddress,start,end)
  const decodeTx = DecodeTransaction(empAbi);
  const decodeAttr = DecodeAttribution(empAbi, defaultReward);

  return highland(stream)
    .map(tx => {
      return decodeTx(tx, {
        blockNumber: tx.block_number,
        blockTimestamp: moment(tx.block_timestamp.value).valueOf(),
        ...tx
      });
    })
    .filter(tx=>tx.name == 'create')
}

function Plan(count = 1,cb){
  function touch(...args){
    if(cb == null) return
    count -= 1
    if(count > 0) return
    cb(...args)
    cb = null
  }
  if(count === 0){
    touch()
  }
  return touch
}

function runStreamSyncer(){
  const attributions = EmpAttributions(empAbi,defaultReward)
  const balances = EmpBalances()
  const attributionStream = getAttributionStream(contract,start,end)
  const eventStream = getEventStream(contract,start,end)
  const blockStream = getBlockStream(start,end)
  // const emitter = new Events()
  let rewards = {}

  // emitter.on('runCalculation',(number)=>{
  //   rewards = calculateBlockReward({ 
  //     attributions:attributions.attributions,
  //     balances:balances.tokens,
  //     whitelist 
  //   },rewards)
  //   // if(Object.keys(rewards).length) console.log('rewards', rewards)
  // })
  // emitter.on('runFinalize',(number)=>{
  //   console.log('run Finalize',number)
  // })

  // const processor = DappRewardProcessor(emitter.emit.bind(emitter))

  let resumeBlocks, resumeEvents, resumeAttributions
  let currentBlock
  let blockExpects = 2

  function ProcessAttributions(){
    return stream => {
      return stream.consume((err,val,push,next)=>{
        if(err) return push(err)
        if(val == highland.nil){
          console.log('attrs done')
          blockExpects--
          resumeBlocks()
          // return
          return push(null,val)
        }

        if(val.blockNumber > currentBlock.number){
          console.log('pause attribution',val.blockNumber)
          resumeAttributions = Plan(1,()=>{
            console.log('resume attr',val.blockNumber)
            push(null,val)
            next()
          })
          resumeBlocks()
        }else{
          push(null,val)
          next()
        }
      })
    }
  }

  const startAttributionStream = attributionStream
    .through(ProcessAttributions())
    .doto(attributions.handleTransaction)
    // .doto(()=>console.log(attributions.attributions.snapshot()))
    .errors(err=>console.log(err))
    // .resume()

  function ProcessEvents(){
    return stream=>{
      return stream.consume((err,val,push,next)=>{
        if(err) return push(err)
        if(val == highland.nil){
          console.log('events done')
          blockExpects--
          // resumeBlocks()
          return push(null,val)
        }
        if(val.blockNumber > currentBlock.number){
          console.log('pasuing event',val.blockNumber)
          resumeEvents = Plan(1,()=>{
            console.log('resume event',val.blockNumber)
            push(null,val)
            next()
          })
          resumeBlocks()
        }else{
          push(null,val)
          next()
        }
      })
    }
  }

  const startEventStream = eventStream
    .through(ProcessEvents())
    .doto(balances.handleEvent)
    .errors(err=>console.log(err))
    // .doto(()=>{
    //   console.log(balances.tokens.snapshot())
    // })
    // .resume()

  function ProcessBlocks(){
    return stream => {
      return stream.consume((err,val,push,next)=>{
        if(err) return push(err)
        if(val == highland.nil){
          console.log('blocks done')
          return push(null,val)
        }

        if(currentBlock == null){
          setTimeout(()=>{
            startEventStream.resume()
            startAttributionStream.resume()
          },0)
        }
        currentBlock = val
        // console.log('pause block',val)
        resumeBlocks = Plan(blockExpects,()=>{
          // console.log('resume block',val)
          rewards = calculateBlockReward({ 
            attributions:attributions.attributions,
            balances:balances.tokens,
            whitelist 
          },rewards)
          push(null,rewards)
          next()
          if(resumeEvents) resumeEvents()
          if(resumeAttributions) resumeAttributions()
        })
      })
    }
  }
  return blockStream
    .through(ProcessBlocks())
    .errors(err=>console.log(err))
    .last()
    // .doto(console.log)
    .toPromise(Promise)

}

runStreamSyncer().then(console.log).catch(console.log)
