const assert = require("assert");
const lodash = require("lodash");

// assumes sorted oldest to newest
// always return price equal to or earlier than requested time
// prices are input directly from coingecko api / price feed.
// [
//   [ timestamp, price],
//   [ timestamp, price],
// ]
function Prices(prices = []) {
  function lookup(time) {
    const index = lodash.sortedIndexBy(prices, [time], ([time]) => {
      return time;
    });
    if (prices[index] === time) return prices[index];
    return prices[index - 1];
  }

  function closest(needle, haystack = prices) {
    return haystack.reduce((a, b) => {
      const aDiff = Math.abs(a[0] - needle);
      const bDiff = Math.abs(b[0] - needle);

      // if differences are equal, return larger? timestamp
      if (aDiff == bDiff) {
        return a < b ? a : b;
      }
      // if diffs are diff, return smallest diff
      return bDiff < aDiff ? b : a;
    });
  }

  return {
    lookup,
    prices,
    closest
  };
}

// users show current ratio of affiliates tagged on thier deposits
// keyed by user address, and show total attributed for each affiliate per user
function SharedAttributions({ scale = 10n ** 18n } = {}) {
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
    if (addresses.has(user)) return get(user);
    return create(user);
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
  function calculateShare(user, affiliate) {
    const data = get(user);
    if (data[affiliate] == null) return 0;
    const sum = Object.values(data).reduce((sum, val) => {
      return sum + BigInt(val);
    }, 0n);
    return percent(data[affiliate], sum, scale).toString();
  }
  function percent(val, sum) {
    return (BigInt(val) * scale) / BigInt(sum);
  }

  // static function
  function calculateShares(contributions = {}) {
    const sum = Object.values(contributions).reduce((sum, val) => {
      return sum + BigInt(val);
    }, 0n);
    if (sum == 0n) return {};
    return Object.entries(contributions).reduce((result, [key, value]) => {
      result[key] = percent(value, sum, scale).toString();
      return result;
    }, {});
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

// Table of address balances. Option to allow negative balances.
function Balances({ allowNegative = false } = {}) {
  const balances = new Map();
  function create(addr) {
    assert(!balances.has(addr), "Already has addr");
    return set(addr, "0");
  }
  function has(addr) {
    return balances.has(addr);
  }
  function get(addr) {
    assert(balances.has(addr), "addr does not exist");
    return balances.get(addr);
  }
  function getOrCreate(addr) {
    if (has(addr)) return get(addr);
    return create(addr);
  }
  function set(addr, balance) {
    if (!allowNegative) {
      assert(balance >= 0n, "balance must be >= 0: " + balance + " for " + addr);
    }
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
    has,
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
  // Used internally, but will insert a block into cache sorted by timestamp ascending
  function insert(data) {
    assert(data.blockNumber, "requires blockNumber");
    const index = lodash.sortedIndexBy(history, data, "blockNumber");
    history.splice(index, 0, data);
    return data;
  }
  function lookup(blockNumber) {
    const index = lodash.sortedIndexBy(history, { blockNumber }, "blockNumber");
    if (history[index] && history[index].blockNumber === blockNumber) return history[index];
    const result = history[index - 1];
    assert(
      result,
      `history does not go back far enough: looked up ${blockNumber} vs earliest ${history[0].blockNumber}`
    );
    return result;
  }
  // get exact block number
  function get(blockNumber) {
    const result = history.find(x => x.blockNumber == blockNumber);
    assert(result, "Not found in history: " + blockNumber);
    return result;
  }
  function has(blockNumber) {
    return !!history.find(x => x.blockNumber == blockNumber);
  }
  function length() {
    return history.length;
  }
  return {
    get,
    has,
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
  Prices
};
