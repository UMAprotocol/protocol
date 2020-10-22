const assert = require("assert");
const lodash = require("lodash");

// assumes sorted oldest to newest
// always return price equal to or earlier than requested time
// prices are input directly from coingecko api
// [
//   [ timestamp, price],
//   [ timestamp, price],
// ]
function Prices(prices=[]){
  function lookup(time) {
    const index = lodash.sortedIndexBy(prices, [time], ([time])=>{
      return time
    });
    if (prices[index] === time) return prices[index];
    return prices[index - 1];
  }

  return {
    lookup,
    prices,
  };
}

// users show current ratio of affiliates tagged on thier deposits
// keyed by user address, and show total attributed for each affiliate per user
function SharedAttributions() {
  const addresses = new Map();
  function create(user) {
    assert(!addresses.has(user), "Already has user");
    return set(user, {});
  }
  function get(user) {
    assert(addresses.has(user), "User does not exist");
    return addresses.get(user);
  }
  function getOrCreate(user) {
    try {
      return get(user);
    } catch (err) {
      return create(user);
    }
  }
  function set(user, data) {
    addresses.set(user, data);
    return data;
  }
  function attribute(user, affiliate, amount) {
    assert(user, "requires user");
    assert(affiliate, "requires affiliate");
    assert(amount, "requires amount");
    const data = getOrCreate(user);
    if (data[affiliate] == null) data[affiliate] = "0";
    data[affiliate] = (BigInt(data[affiliate]) + BigInt(amount)).toString();
    return set(user, data);
  }
  function calculateShare(user, affiliate,scale=1000000n) {
    const data = get(user);
    if (data[affiliate] == null) return 0;
    const sum = Object.values(data).reduce((sum, val) => {
      return sum + BigInt(val);
    }, 0n);
    return percent(data[affiliate],sum,scale).toString()
  }
  function percent(val,sum,scale=10000n){
    return BigInt(val) * scale / BigInt(sum) 
  }

  // static function
  function calculateShares(contributions={},scale=1000000n){
    const sum = Object.values(contributions).reduce((sum, val) => {
      return sum + BigInt(val);
    }, 0n);
    if(sum == 0n) return {};
    return Object.entries(contributions).reduce((result,[key,value])=>{
      result[key] = percent(value,sum,scale).toString()
      return result
    },{})
  }

  function snapshot() {
    return [...addresses.entries()].reduce((result, [key, value]) => {
      result[key] = calculateShares(value);
      return result;
    }, {});
  }

  return {
    get,
    set,
    create,
    getOrCreate,
    attribute,
    calculateShare,
    snapshot
  };
}

function Balances() {
  const balances = new Map();
  function create(addr) {
    assert(!balances.has(addr), "Already has addr");
    return set(addr, "0");
  }
  function get(addr) {
    assert(balances.has(addr), "addr does not exist");
    return balances.get(addr);
  }
  function getOrCreate(addr) {
    try {
      return get(addr);
    } catch (err) {
      return create(addr);
    }
  }
  function set(addr, balance) {
    amount = BigInt(balance);
    assert(balance >= 0n,'balance must be >= 0: ' + balance)
    balances.set(addr, balance);
    return balance;
  }
  function add(addr, amount) {
    amount = BigInt(amount);
    assert(amount >= 0n, "amount must be >= 0: " + amount);
    const balance = getOrCreate(addr);
    return set(addr, (BigInt(balance) + BigInt(amount)).toString());
  }
  function sub(addr, amount) {
    amount = BigInt(amount);
    assert(amount >= 0n, "amount must be >= 0: " + amount);
    const balance = getOrCreate(addr);
    return set(addr, (BigInt(balance) - BigInt(amount)).toString());
  }
  function snapshot() {
    return [...balances.entries()].reduce((result, [key, value]) => {
      result[key] = value;
      return result;
    }, {});
  }

  return {
    get,
    set,
    create,
    getOrCreate,
    sub,
    add,
    snapshot
  };
}

// hold any kind of data which can have a history by block number
// and also has gaps, so that  not every block number is recorded.
function History() {
  const history = [];
  // Used internally, but will insert a block into cache sorted by timestamp
  function insert(data) {
    assert(data.blockNumber, "requires blockNumber");
    const index = lodash.sortedIndexBy(history, data, "blockNumber");
    history.splice(index, 0, data);
    return data;
  }
  function lookup(blockNumber) {
    const index = lodash.sortedIndexBy(history, { blockNumber }, "blockNumber");
    if (history[index] && history[index].blockNumber === blockNumber) return history[index];
    return history[index - 1];
  }
  function length() {
    return history.length;
  }
  return {
    insert,
    lookup,
    history,
    length
  };
}

module.exports = {
  SharedAttributions,
  History,
  Balances,
  Prices,
};
