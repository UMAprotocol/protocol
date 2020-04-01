const { toWei } = web3.utils;

const { UniswapPriceFeed } = require("../UniswapPriceFeed");
const { mineTransactionsAtTime, startMining, stopMining, minePendingTransactions } = require("../../common/SolidityTestUtils.js");

const UniswapMock = artifacts.require("UniswapMock");
const Uniswap = artifacts.require("Uniswap");

contract("UniswapPriceFeed.js", function(accounts) {
  const owner = accounts[0];

  let mockUniswap;
  let uniswapPriceFeed;

  beforeEach(async function() {
    uniswapMock = await UniswapMock.new({ from: owner });
    uniswapPriceFeed = new UniswapPriceFeed(Uniswap.abi, web3, uniswapMock.address);
  });

  it("Basic current price", async function() {
    await uniswapMock.setPrice(toWei("2"), toWei("1"));
    await uniswapPriceFeed._update();

    assert.equal(uniswapPriceFeed.getCurrentPrice().toString(), toWei("0.5"));
  });

  it("Correctly selects most recent price", async function() {
    await uniswapMock.setPrice(toWei("1"), toWei("1"));
    await uniswapMock.setPrice(toWei("2"), toWei("1"));
    await uniswapMock.setPrice(toWei("4"), toWei("1"));
    await uniswapPriceFeed._update();

    assert.equal(uniswapPriceFeed.getCurrentPrice().toString(), toWei("0.25"));
  });

  it("Selects most recent price in same block", async function() {
    // Just use current system time because the time doesn't matter.
    const time = Math.round(new Date().getTime() / 1000);

    const transactions = [
      uniswapMock.contract.methods.setPrice(toWei("1"), toWei("1")),
      uniswapMock.contract.methods.setPrice(toWei("2"), toWei("1")),
      uniswapMock.contract.methods.setPrice(toWei("4"), toWei("1"))
    ];

    await mineTransactionsAtTime(web3, transactions, time, owner)
    await uniswapPriceFeed._update();

    assert.equal(uniswapPriceFeed.getCurrentPrice().toString(), toWei("0.25"));
  });

  it("No price", async function() {
    await uniswapPriceFeed._update();

    assert.equal(uniswapPriceFeed.getCurrentPrice(), null);
  });
  // TODO: add tests to ensure intra-transaction price changes are handled correctly.
});
