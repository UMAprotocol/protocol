const { toWei, toBN } = web3.utils;

const { UniswapPriceFeed } = require("../UniswapPriceFeed");
const { mineTransactionsAtTime } = require("../../common/SolidityTestUtils.js");
const { delay } = require("../delay.js");
const { MAX_SAFE_JS_INT } = require("../../common/Constants");

const UniswapMock = artifacts.require("UniswapMock");
const Uniswap = artifacts.require("Uniswap");

contract("UniswapPriceFeed.js", function(accounts) {
  const owner = accounts[0];

  let mockUniswap;
  let uniswapPriceFeed;
  let mockTime = 0;

  beforeEach(async function() {
    uniswapMock = await UniswapMock.new({ from: owner });
    uniswapPriceFeed = new UniswapPriceFeed(Uniswap.abi, web3, uniswapMock.address, 3600, () => mockTime);
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

  it.only("Selects most recent price in same block", async function() {
    // Just use current system time because the time doesn't matter.
    const time = Math.round(new Date().getTime() / 1000);

    const transactions = [
      uniswapMock.contract.methods.setPrice(toWei("1"), toWei("1")),
      uniswapMock.contract.methods.setPrice(toWei("2"), toWei("1")),
      uniswapMock.contract.methods.setPrice(toWei("4"), toWei("1"))
    ];

    // Ensure all are included in the same block
    const [receipt1, receipt2, receipt3] = await mineTransactionsAtTime(web3, transactions, time, owner);
    assert.equal(receipt2.blockNumber, receipt1.blockNumber);
    assert.equal(receipt3.blockNumber, receipt1.blockNumber);

    // Update the PF and ensure the price it gives is the last price in the block.
    await uniswapPriceFeed._update();
    assert.equal(uniswapPriceFeed.getCurrentPrice().toString(), toWei("0.25"));
  });

  it("No price", async function() {
    await uniswapPriceFeed._update();

    assert.equal(uniswapPriceFeed.getCurrentPrice(), null);
    assert.equal(uniswapPriceFeed.getCurrentTwap(), null);
  });

  // Basic test to verify TWAP (non simulated time).
  it("Basic 2-price TWAP", async function() {
    // Update the prices with a small amount of time between.
    const result1 = await uniswapMock.setPrice(toWei("1"), toWei("1"));
    await delay(1000);
    const result2 = await uniswapMock.setPrice(toWei("2"), toWei("1"));

    const getBlockTime = async result => {
      return (await web3.eth.getBlock(result.receipt.blockNumber)).timestamp;
    };

    // Grab the exact blocktimes.
    const time1 = await getBlockTime(result1);
    const time2 = await getBlockTime(result2);
    mockTime = time2 + 1;

    // Allow the library to compute the TWAP.
    await uniswapPriceFeed._update();


    const totalTime = mockTime - time1;
    const weightedPrice1 = toBN(toWei("1")).muln(time2 - time1);
    const weightedPrice2 = toBN(toWei("0.5")); // 0.5 * 1 second since the mockTime is one second past time2.

    // Compare the TWAPs.
    assert.equal(uniswapPriceFeed.getCurrentTwap().toString(), weightedPrice1.add(weightedPrice2).divn(totalTime).toString());
  });

  it("All events before window", async function() {
    await uniswapMock.setPrice(toWei("1"), toWei("1"));
    await uniswapMock.setPrice(toWei("2"), toWei("1"));
    await uniswapMock.setPrice(toWei("4"), toWei("1"));

    // Set the mock time to very far in the future.
    mockTime = MAX_SAFE_JS_INT;

    await uniswapPriceFeed._update();

    // Expect that the TWAP is just the most recent price, since that was the price throughout the current window.
    assert.equal(uniswapPriceFeed.getCurrentTwap().toString(), toWei("0.25"));
  });

  it("All events after window", async function() {
    await uniswapMock.setPrice(toWei("1"), toWei("1"));
    await uniswapMock.setPrice(toWei("2"), toWei("1"));
    await uniswapMock.setPrice(toWei("4"), toWei("1"));

    // Set the mock time to very far in the past.
    mockTime = 5000;

    await uniswapPriceFeed._update();

    // Since all the events are past our window, there is no valid price, and the TWAP should return null.
    assert.equal(uniswapPriceFeed.getCurrentTwap(), null);
  });
  // TODO: add the following TWAP tests using simulated block times:
  // - Some events pre TWAP window, some inside window.
  // - Some events post TWAP window, some inside window.
  // - Complex (5+ value) TWAP with events overlapping on both sides of the window.

  // TODO: add tests to ensure intra-transaction price changes are handled correctly.
});
