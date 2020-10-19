const assert = require("assert")
const lodash = require("lodash");

// users show current ratio of affiliates tagged on thier deposits 
// keyed by user address, and show total attributed for each affiliate per user
function SharedAttributions(){
  const addresses = new Map()
  function create(user){
    assert(!addresses.has(user),'Already has user')
    return set(user,{})
  }
  function get(user){
    assert(addresses.has(user),'User does not exist')
    return addresses.get(user)
  }
  function getOrCreate(user){
    try{
      return get(user)
    }catch(err){
      return create(user)
    }
  }
  function set(user,data){
    addresses.set(user,data)
    return data
  }
  function attribute(user,affiliate,amount){
    assert(user,'requires user')
    assert(affiliate,'requires affiliate')
    assert(amount,'requires amount')
    const data = getOrCreate(user)
    if(data[affiliate] == null) data[affiliate] = '0'
    data[affiliate] = (BigInt(data[affiliate]) + BigInt(amount)).toString()
    return set(user,data)
  }
  function calculateShare(user,affiliate){
    const data = get(user)
    if(data[affiliate] == null) return 0
    const sum = Object.values(data).reduce((sum,val)=>{
      return sum + BigInt(val)
    },0n)
    const scale = 100000000n
    return Number(BigInt(data[affiliate]) * scale / sum) / Number(scale)
  }

  function snapshot(){
    return [...addresses.entries()].reduce((result,[key,value])=>{
      result[key] = value
      return result
    },{})
  }

  return {
    get,
    set,
    create,
    getOrCreate,
    attribute,
    calculateShare,
    snapshot,
  }
}

function Balances(){
  const balances = new Map()
  function create(addr){
    assert(!balances.has(addr),'Already has addr')
    return set(addr,'0')
  }
  function get(addr){
    assert(balances.has(addr),'addr does not exist')
    return balances.get(addr)
  }
  function getOrCreate(addr){
    try{
      return get(addr)
    }catch(err){
      return create(addr)
    }
  }
  function set(addr,balance){
    amount = BigInt(balance)
    // assert(balance >= 0n,'balance must be >= 0: ' + balance)
    balances.set(addr,balance)
    return balance
  }
  function add(addr,amount){
    amount = BigInt(amount)
    assert(amount >= 0n,'amount must be >= 0: '+ amount)
    const balance = getOrCreate(addr)
    return set(addr,(BigInt(balance) + BigInt(amount)).toString())
  }
  function sub(addr,amount){
    amount = BigInt(amount)
    assert(amount >= 0n,'amount must be >= 0: ' + amount)
    const balance = getOrCreate(addr)
    return set(addr,(BigInt(balance) - BigInt(amount)).toString())
  }
  function snapshot(){
    return [...balances.entries()].reduce((result,[key,value])=>{
      result[key] = value
      return result
    },{})
  }

  return {
    get,
    set,
    create,
    getOrCreate,
    sub,
    add,
    snapshot,
  }
}

function BalanceDeltas() {
  const deltas = new Map()
  // function makeId(data){
    // assert(data.hash,'requires hash')
    // assert(data.index >= 0,'requires index')
    // return [data.hash,data.index].join('!')
  // }
  function create(data){
    assert(data.hash,'requires hash')
    assert(!deltas.has(data.hash),'delta already exists')
    return set(data.hash,data)
  }
  function set(id,data={}){
    assert(id,'requires id')
    assert(data.delta,'requires delta')
    assert(data.address,'requires address')
    deltas.set(id,data)
    return data
  }
  function get(id){
    assert(deltas.has(hash),'no data for transaction')
    return deltas.get(hash)
  }
  function balance(address){
    assert(address,'requires address')
    let balance = 0
    deltas.forEach(data=>{
      if(data.address != address) return
      balance += data.delta
    })
    return balance
  }
  return {
    create,
    get,
    set,
    balance,
    makeId,
  }
}

// hold any kind of data which can have a history by block number
// and also has gaps, so that  not every block number is recorded.
function History(){
  const history = []
  // Used internally, but will insert a block into cache sorted by timestamp
  function insert(data) {
    assert(data.blockNumber ,'requires blockNumber')
    const index = lodash.sortedIndexBy(history, data, "blockNumber");
    history.splice(index, 0, data);
    return data;
  }
  function lookup(blockNumber){
    const index = lodash.sortedIndexBy(history, { blockNumber }, "blockNumber");
    if (history[index] && history[index].blockNumber === blockNumber) return history[index];
    return history[index - 1];
  }
  function length(){
    return history.length
  }
  return {
    insert,lookup,history,length
  }
}

// contains balance histories for multiple addresses
function BalanceHistories(){
  const histories = new Map()
  function create(address){
    assert(!histories.has(address),'histories exist')
    const result = History()
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
  SharedAttributions,
  History,
  Balances,
  BalanceHistories,
  BalanceDeltas,
}


