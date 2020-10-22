const test = require("tape");
const lodash = require("lodash");
const { History, Balances, SharedAttributions, Prices } = require("../libs/models");
const Coingecko = require('../libs/coingecko')
const moment = require("moment");

test("SharedAttributions", t => {
  let attributions;
  t.test("init", t => {
    attributions = SharedAttributions();
    t.ok(attributions);
    t.end();
  });
  t.test("create", t => {
    const result = attributions.create("test");
    t.ok(result);
    t.end();
  });
  t.test("attribute a", t => {
    const result = attributions.attribute("test", "a", 1);
    t.equal(result.a, "1");
    t.end();
  });
  t.test("attribute b", t => {
    const result = attributions.attribute("test", "b", 1);
    t.equal(result.a, "1");
    t.equal(result.b, "1");
    t.end();
  });
  t.test("calcShare", t => {
    const result = attributions.calculateShare("test", "a");
    t.equal(result, '500000');
    t.end();
  });
});

test("Balances", t => {
  let balances;
  t.test("init", t => {
    balances = Balances();
    t.ok(balances);
    t.end();
  });
  t.test("create", t => {
    const result = balances.create("test");
    t.equal(result, "0");
    t.end();
  });
  t.test("get", t => {
    const result = balances.get("test");
    t.equal(result, "0");
    t.end();
  });
  t.test("add", t => {
    const result = balances.add("test", 2);
    t.equal(result, "2");
    t.end();
  });
  t.test("sub", t => {
    const result = balances.sub("test", 1);
    t.equal(result, "1");
    t.end();
  });
  t.test("snapshot", t => {
    const result = balances.snapshot();
    t.equal(result.test, "1");
    t.end();
  });
});

test("History", t => {
  let history;
  t.test("init", t => {
    history = History();
    t.ok(history);
    t.end();
  });
  t.test("insert", t => {
    history.insert({ blockNumber: 1, balance: 1 });
    t.end();
  });
  t.test("lookup", t => {
    const result = history.lookup(1);
    t.equal(result.balance, 1);
    t.equal(result.blockNumber, 1);
    t.end();
  });
});

test("Prices",t=>{
  let prices,seed
  const token = '0xD16c79c8A39D44B2F3eB45D2019cd6A42B03E2A9'
  t.test('init',async t=>{
    seed =await Coingecko().chart(token,'usd','10')
    prices = Prices(seed.prices)
    t.ok(seed)
    t.ok(prices)
    t.end()
  })
  t.test('lookup',t=>{
    const time = moment().subtract(5,'days').valueOf()
    const result = prices.lookup(time)
    t.ok(result[0]<=time)
    t.end()
  })
})
