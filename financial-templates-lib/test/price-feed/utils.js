const lodash = require("lodash");

const { PriceHistory, BlockHistory } = require("../../price-feed/utils");
const { advanceBlockAndSetTime, stopMining, startMining } = require("@umaprotocol/common");

contract("Price Feed Utils", function(accounts) {
  let blockHistory, priceHistory;
  let now = Math.floor(Date.now() / 1000);
  let premine = 5;
  let blocktime = 15;
  let age = premine * blocktime;

  async function getPrice(number) {
    return number;
  }

  before(async function() {
    blockHistory = BlockHistory(web3);
    priceHistory = PriceHistory(getPrice);
    for (i of lodash.times(premine)) {
      const ts = Math.floor(now - blocktime * (premine - i));
      await advanceBlockAndSetTime(web3, ts);
    }
    await blockHistory.update(age, now);
  });

  it("listBlocks", async function() {
    assert.isAbove(blockHistory.listBlocks().length, 0);
  });
  it("getClosestTime", function() {
    const time = now - Math.floor(age / 2);
    const block = blockHistory.getClosestTime(time);
    assert.isOk(block);
    assert.isOk(blockHistory.has(block.number));
    assert.isAtLeast(block.timestamp, time);
  });
  it("priceHistory.update", async function() {
    await priceHistory.update(blockHistory.listBlocks());
  });
  it("priceHistory.currentPrice", async function() {
    await priceHistory.update(blockHistory.listBlocks());
    const result = priceHistory.currentPrice();
    assert.isOk(result);
  });
  it("priceHistory.getBetween", async function() {
    await priceHistory.update(blockHistory.listBlocks());
    const result = priceHistory.getBetween(now - age, now);
    assert.isOk(result);
    assert.isOk(result.length);
  });
  it("get price by timestamp", async function() {
    const time = now - age;
    await priceHistory.update(blockHistory.listBlocks());
    const block = blockHistory.getClosestTime(time);
    const result = priceHistory.get(block.timestamp);
    assert.equal(result, await getPrice(block.number));
  });
});
