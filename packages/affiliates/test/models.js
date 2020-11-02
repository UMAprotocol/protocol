const { assert } = require("chai");
const { History, Balances, SharedAttributions, Prices } = require("../libs/models");
const Coingecko = require("../libs/coingecko");
const moment = require("moment");

describe("SharedAttributions", function() {
  let attributions;
  it("init", function() {
    attributions = SharedAttributions();
    assert.ok(attributions);
  });
  it("create", function() {
    const result = attributions.create("test");
    assert.ok(result);
  });
  it("attribute a", function() {
    const result = attributions.attribute("test", "a", 1);
    assert.equal(result.a, "1");
  });
  it("attribute b", function() {
    const result = attributions.attribute("test", "b", 1);
    assert.equal(result.a, "1");
    assert.equal(result.b, "1");
  });
  it("calcShare", function() {
    const result = attributions.calculateShare("test", "a");
    // represents .5 in wei
    assert.equal(result, 5n * 10n ** 17n);
  });
});

describe("Balances", function() {
  let balances;
  it("init", function() {
    balances = Balances();
    assert.ok(balances);
  });
  it("create", function() {
    const result = balances.create("test");
    assert.equal(result, "0");
  });
  it("get", function() {
    const result = balances.get("test");
    assert.equal(result, "0");
  });
  it("add", function() {
    const result = balances.add("test", 2);
    assert.equal(result, "2");
  });
  it("sub", function() {
    const result = balances.sub("test", 1);
    assert.equal(result, "1");
  });
  it("snapshot", function() {
    const result = balances.snapshot();
    assert.equal(result.test, "1");
  });
});

describe("History", function() {
  let history;
  it("init", function() {
    history = History();
    assert.ok(history);
  });
  it("lookup", function() {
    history.insert({ blockNumber: 1, balance: 1 });
    const result = history.lookup(1);
    assert.equal(result.balance, 1);
    assert.equal(result.blockNumber, 1);
  });
});

describe("Prices", function() {
  let prices, seed;
  const token = "0xD16c79c8A39D44B2F3eB45D2019cd6A42B03E2A9";
  const startingTimestamp = moment("2020-09-23 23:00:00", "YYYY-MM-DD  HH:mm Z").valueOf();
  const endingTimestamp = moment("2020-10-05 23:00:00", "YYYY-MM-DD  HH:mm Z").valueOf();
  it("init", async function() {
    seed = await Coingecko().chart(token, "usd", startingTimestamp, endingTimestamp);
    prices = Prices(seed.prices);
    assert.ok(seed);
    assert.ok(prices);
  });
  it("lookup", function() {
    const time = moment()
      .subtract(5, "days")
      .valueOf();
    const result = prices.lookup(time);
    assert.ok(result[0] <= time);
  });
  it("closest", function() {
    const time = moment()
      .subtract(5, "days")
      .valueOf();
    const result = prices.closest(time);
    assert.ok(result[0]);
    assert.ok(result[1]);
  });
});
