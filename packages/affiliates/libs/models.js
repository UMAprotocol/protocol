const Web3 = require("web3");
const assert = require("assert")
const { BN } = Web3.utils
const lodash = require("lodash");

// Contains balance history for a single address
// inserts and looks up by block number
function BalanceHistory(){
  const history = []
  // Used internally, but will insert a block into cache sorted by timestamp
  function insert(data) {
    const index = lodash.sortedIndexBy(history, data, "blockNumber");
    history.splice(index, 0, data);
    return data;
  }
  function lookup(blockNumber){
    const index = lodash.sortedIndexBy(history, { blockNumber }, "blockNumber");
    if (history[index] && history[index].blockNumber === blockNumber) return history[index];
    return history[index - 1];
  }
  return {
    insert,lookup
  }
}

// contains balance histories for multiple addresses
function BalanceHistories(){
  const histories = new Map()
  function create(address){
    assert(!histories.has(address),'histories exist')
    const result = BalanceHistory()
    histories.set(address,result)
    return result
  }
  function get(address){
    assert(histories.has(address),'No history for address')
    return histories.get(address)
  }
  function getOrCreate(address){
    try{
      return get(address)
    }catch(err){
      return create(address)
    }
  }
  function insert(address,{blockNumber,balance}){
    const history = getOrCreate(address)
    history.insert({blockNumber,balance})
  }
  function lookup(address,blockNumber){
    const history = get(address)
    return history.lookup(blockNumber)
  }
  return {
    insert,
    lookup,
    get,
    getOrCreate,
    create,
  }
}

// collects total attributions for an address
// and processes them into % shares
function Attributions(){
  const attributions = new Map()
  let sum = 0

  function create(address,amount=0){
    assert(!attributions.has(address),'already exists')
    return set(address,amount)
  }
  function get(address){
    assert(attributions.has(address),'does not exist')
    return attributions.get(address)
  }

  function getOrCreate(address,amount){
    try{
      return get(address)
    }catch(err){
      return create(address,amount)
    }
  }
  function set(address,amount){
    attributions.set(address,amount)
    return amount
  }
  function add(address,amount){
    const total = getOrCreate(address)
    sum += amount
    return set(address,total + amount)
  }
  function sub(address,amount){
    const total = getOrCreate(address)
    sum -= amount
    return set(address,total - amount)
  }
  function getSum(){
    return sum
  }
  function getPercent(address){
    const balance = getOrCreate(address)
    return balance/sum
  }
  function listPercents(){
    return [...attributions.keys()].reduce((result,address)=>{
      const percent = getPercent(address)
      if(percent <= 0) return result
      result[address] = percent
      return result
    },{})
  }

  return {
    add,
    sub,
    create,
    getOrCreate,
    set,
    getSum,
    getPercent,
    listPercents,
  }
}

module.exports = {
  Attributions,
  BalanceHistory,
  BalanceHistories
}

