const assert = require("assert");
const lodash = require("lodash");

// static helper functions
function percent(val, sum, scale = 10n ** 18n) {
  return (BigInt(val) * scale) / BigInt(sum);
}

function calculateShares(contributions = {}, sum, scale = 10n ** 18n) {
  sum =
    sum ||
    Object.values(contributions).reduce((sum, val) => {
      return sum + BigInt(val);
    }, 0n);

  if (sum == 0n) return {};

  return Object.entries(contributions).reduce((result, [key, value]) => {
    result[key] = percent(value, sum, scale).toString();
    return result;
  }, {});
}
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

// Keeps track of all attributions for a particular user. This also allows a lookup to calculate
// who has attributed what amount based on an arbitrary balance passed in for that user.
function AttributionLookback({ scale = 10n ** 18n } = {}) {
  // maps user addresses to an array of tagged attribution events
  const addresses = new Map();
  function create(user) {
    assert(!addresses.has(user), "Already has user");
    return set(user, []);
  }
  function get(user) {
    assert(addresses.has(user), "User does not exist");
    return addresses.get(user);
  }
  function set(user, data) {
    addresses.set(user, data);
    return data;
  }
  function getOrCreate(user) {
    if (addresses.has(user)) return get(user);
    return create(user);
  }
  function attribute(user, affiliate, amount) {
    assert(user, "requires user");
    assert(affiliate, "requires affiliate");
    assert(amount, "requires amount");
    const history = getOrCreate(user);
    // keep youngest attributions at the start of history
    history.unshift({ user, affiliate, amount });
    return set(user, history);
  }
  function getByIndex(user, index) {
    const history = getOrCreate(user);
    assert(history[index], "Index has not been set: " + index);
    return history[index];
  }
  function setByIndex(user, index, data) {
    const history = get(user);
    history[index] = data;
    return set(user, history);
  }

  function getAttributionPercents(user, amount) {
    const attributions = getAttributions(user, amount);
    return calculateShares(attributions, amount, scale);
  }
  // search through a users attribution events and return the tags which attributed up to that amount.
  // This goes through youngest attributions first, and accumulates attributions until the amount passed in
  // is consumed. Its possible the last attribution may accumulate to more than the amount requested in that
  // case it should be truncated. This returns an object keyed by tag address:
  // {
  //    tagA: amount,
  //    tagB: amount,
  // }
  function getAttributions(user, amount) {
    const history = get(user);
    const { attributions, amountRemaining } = history.reduce(
      ({ attributions, amountRemaining }, next) => {
        // We have reached the amount needed to ignore rest of attributions
        if (amountRemaining <= 0n) return { attributions, amountRemaining };
        // We have not  reached amount needed, therefore initialize this affiliate if not already
        if (attributions[next.affiliate] == null) attributions[next.affiliate] = 0n;

        let attributionUsed;
        // the sum does not reach the required amount with this attribution, so record it all
        if (amountRemaining >= next.amount) {
          attributionUsed = BigInt(next.amount);
        } else {
          // the sum surasses the amount required, we only can go up to sum, so calculate only amount needed from attribution
          attributionUsed = amountRemaining;
        }
        attributions[next.affiliate] += attributionUsed;
        amountRemaining -= attributionUsed;

        return {
          attributions,
          amountRemaining
        };
      },
      { attributions: {}, amountRemaining: BigInt(amount) }
    );

    assert(amountRemaining === 0n, "Too few attribution events to sum to amount");
    return attributions;
  }

  function forEach(cb) {
    addresses.forEach((history, userid) => {
      history.forEach(({ affiliate, amount }, index) => {
        cb(userid, affiliate, amount, index);
      });
    });
  }

  function getTable() {
    return addresses;
  }

  return {
    get,
    set,
    setByIndex,
    getByIndex,
    create,
    getOrCreate,
    attribute,
    getAttributionPercents,
    getAttributions,
    forEach,
    getTable
  };
}

// users show current ratio of affiliates tagged on thier deposits
// keyed by user address, and show total attributed for each affiliate per user
// addresses are converted to lower case because theres inconsistent address reporting from various sources.
function SharedAttributions({ scale = 10n ** 18n } = {}) {
  const addresses = new Map();
  function create(user) {
    user = user.toLowerCase();
    assert(!addresses.has(user), "Already has user");
    return set(user, {});
  }
  function get(user) {
    user = user.toLowerCase();
    assert(addresses.has(user), "User does not exist");
    return addresses.get(user);
  }
  function getAttribution(user, affiliate) {
    affiliate = affiliate.toLowerCase();
    return get(user)[affiliate.toLowerCase()] || "0";
  }
  function getOrCreate(user) {
    user = user.toLowerCase();
    if (addresses.has(user)) return get(user);
    return create(user);
  }
  function set(user, data) {
    user = user.toLowerCase();
    addresses.set(user, data);
    return data;
  }
  function attribute(user, affiliate, amount) {
    assert(user, "requires user");
    assert(affiliate, "requires affiliate");
    assert(amount, "requires amount");
    const data = getOrCreate(user);
    affiliate = affiliate.toLowerCase();
    if (data[affiliate] == null) data[affiliate] = "0";
    data[affiliate] = (BigInt(data[affiliate]) + BigInt(amount)).toString();
    return set(user, data);
  }
  function calculateShare(user, affiliate) {
    affiliate = affiliate.toLowerCase();
    const data = getOrCreate(user);
    if (data[affiliate] == null) return "0";
    const sum = Object.values(data).reduce((sum, val) => {
      return sum + BigInt(val);
    }, 0n);
    return percent(data[affiliate], sum, scale).toString();
  }

  function percent(val, sum, scale) {
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

  function forEach(cb) {
    addresses.forEach((affiliates, userid) => {
      Object.entries(affiliates).forEach(([affiliateid, amount]) => {
        cb(userid, affiliateid, amount);
      });
    });
  }

  return {
    get,
    set,
    create,
    getOrCreate,
    attribute,
    calculateShare,
    snapshot,
    addresses,
    forEach,
    getAttribution
  };
}

// Table of address balances. Option to allow negative balances.
function Balances({ allowNegative = false } = {}) {
  let total = 0n;
  const balances = new Map();
  function keys() {
    return [...balances.keys()];
  }
  function create(addr) {
    addr = addr.toLowerCase();
    assert(!balances.has(addr), "Already has addr");
    return set(addr, "0");
  }
  function has(addr) {
    addr = addr.toLowerCase();
    return balances.has(addr);
  }
  function get(addr) {
    addr = addr.toLowerCase();
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
    addr = addr.toLowerCase();
    balances.set(addr, balance);
    return balance;
  }
  function add(addr, amount) {
    amount = BigInt(amount);
    assert(amount >= 0n, "amount must be >= 0: " + amount);
    const balance = getOrCreate(addr);
    const result = set(addr, (BigInt(balance) + BigInt(amount)).toString());
    total = total + BigInt(amount);
    return result;
  }
  function sub(addr, amount) {
    amount = BigInt(amount);
    assert(amount >= 0n, "amount must be >= 0: " + amount);
    const balance = getOrCreate(addr);
    const result = set(addr, (BigInt(balance) - BigInt(amount)).toString());
    total = total - BigInt(amount);
    return result;
  }
  function snapshot() {
    return [...balances.entries()].reduce((result, [key, value]) => {
      result[key] = value;
      return result;
    }, {});
  }
  function getTotal() {
    return total.toString();
  }
  function getPercent(userid, scale = 10n ** 18n) {
    const balance = getOrCreate(userid);
    return ((BigInt(balance) * scale) / total).toString();
  }

  function forEach(cb) {
    balances.forEach(cb);
  }

  return {
    get,
    set,
    has,
    create,
    getOrCreate,
    sub,
    add,
    snapshot,
    keys,
    getTotal,
    getPercent,
    forEach,
    balances
  };
}

// hold any kind of data which can have a history by block number
// and also has gaps, so that  not every block number is recorded.
function History() {
  const history = [];
  // Used internally, but will insert a block into cache sorted by timestamp ascending
  function insert(data) {
    assert(typeof data.blockNumber === "number" && data.blockNumber >= 0, "requires blockNumber");
    const index = lodash.sortedIndexBy(history, data, "blockNumber");
    history.splice(index, 0, data);
    return data;
  }
  function lookup(blockNumber) {
    const index = lodash.sortedIndexBy(history, { blockNumber }, "blockNumber");
    assert(history.length, "history is empty");
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
  AttributionLookback,
  History,
  Balances,
  Prices
};
