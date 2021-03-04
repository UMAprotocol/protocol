const winston = require("winston");

const { LPPriceFeed } = require("../../src/price-feed/LPPriceFeed");
const { advanceBlockAndSetTime, parseFixed } = require("@uma/common");
const { BlockFinder } = require("../../src/price-feed/utils");
const { getTruffleContract } = require("@uma/core");

const CONTRACT_VERSION = "latest";

const ERC20Interface = getTruffleContract("IERC20Standard", web3, CONTRACT_VERSION);
const ERC20 = getTruffleContract("ExpandedERC20", web3, CONTRACT_VERSION);

contract("LPPriceFeed.js", function(accounts) {
  const owner = accounts[0];

  let pool;
  let token;
  let lpPriceFeed;
  let mockTime = 0;
  let dummyLogger;
  let poolDecimals = 18;
  let tokenDecimals = 8;
  let priceFeedDecimals = 12;

  beforeEach(async function() {
    pool = await ERC20.new("LP Pool", "LP", poolDecimals, { from: owner });
    token = await ERC20.new("Test Token", "TT", tokenDecimals, { from: owner });
    pool.addMinter(owner);
    token.addMinter(owner);

    dummyLogger = winston.createLogger({
      level: "info",
      transports: [new winston.transports.Console()]
    });

    lpPriceFeed = new LPPriceFeed({
      logger: dummyLogger,
      web3,
      getTime: () => mockTime,
      erc20Abi: ERC20Interface.abi,
      tokenAddress: token.address,
      poolAddress: pool.address,
      priceFeedDecimals
    });
  });

  it("Basic current price", async function() {
    await pool.mint(owner, parseFixed("100", poolDecimals));
    await token.mint(pool.address, parseFixed("25", tokenDecimals));
    await lpPriceFeed.update();

    assert.equal(lpPriceFeed.getCurrentPrice().toString(), parseFixed("0.25", priceFeedDecimals).toString());
  });

  it("Correctly selects most recent price", async function() {
    await pool.mint(owner, parseFixed("100", poolDecimals));
    await token.mint(pool.address, parseFixed("25", tokenDecimals));
    await pool.mint(owner, parseFixed("100", poolDecimals));
    await lpPriceFeed.update();

    assert.equal(lpPriceFeed.getCurrentPrice().toString(), parseFixed("0.125", priceFeedDecimals).toString());
  });

  it("Historical Price", async function() {
    await pool.mint(owner, parseFixed("100", poolDecimals));
    await token.mint(pool.address, parseFixed("25", tokenDecimals));

    await lpPriceFeed.update();

    // Ensure that the next block is mined at a later time.
    const { timestamp: firstPriceTimestamp } = await web3.eth.getBlock("latest");
    await advanceBlockAndSetTime(web3, firstPriceTimestamp + 10);

    await pool.mint(owner, parseFixed("100", poolDecimals));

    const { timestamp: secondPriceTimestamp } = await web3.eth.getBlock("latest");

    assert.equal(
      (await lpPriceFeed.getHistoricalPrice(firstPriceTimestamp)).toString(),
      parseFixed("0.25", priceFeedDecimals)
    );
    assert.equal(
      (await lpPriceFeed.getHistoricalPrice(firstPriceTimestamp + 5)).toString(),
      parseFixed("0.25", priceFeedDecimals)
    );
    assert.equal(
      (await lpPriceFeed.getHistoricalPrice(secondPriceTimestamp - 1)).toString(),
      parseFixed("0.25", priceFeedDecimals)
    );
    assert.equal(
      (await lpPriceFeed.getHistoricalPrice(secondPriceTimestamp)).toString(),
      parseFixed("0.125", priceFeedDecimals)
    );
  });

  it("Zero LP shares", async function() {
    await token.mint(pool.address, parseFixed("25", tokenDecimals));

    await lpPriceFeed.update();

    assert.equal(lpPriceFeed.getCurrentPrice().toString(), "0");
  });

  it("Update Frequency", async function() {
    await pool.mint(owner, parseFixed("1", poolDecimals));
    await token.mint(pool.address, parseFixed("50", tokenDecimals));
    await lpPriceFeed.update();
    assert.equal(lpPriceFeed.getCurrentPrice().toString(), parseFixed("50", priceFeedDecimals).toString());
    const initialTime = mockTime;
    assert.equal(lpPriceFeed.getLastUpdateTime(), initialTime);

    // Increment time to just under the 1 minute default threshold and push a new price.
    mockTime += 59;
    await pool.mint(owner, parseFixed("4", poolDecimals));
    await lpPriceFeed.update();
    assert.equal(lpPriceFeed.getLastUpdateTime(), initialTime); // No change in update time.

    // Price should not have changed.
    assert.equal(lpPriceFeed.getCurrentPrice().toString(), parseFixed("50", priceFeedDecimals).toString());

    // An increment of one more secont + update should trigger the feed to pull in the new price.
    mockTime += 1;
    await lpPriceFeed.update();
    assert.equal(lpPriceFeed.getCurrentPrice().toString(), parseFixed("10", priceFeedDecimals).toString());
    assert.equal(lpPriceFeed.getLastUpdateTime(), mockTime); // Update time should have no incremented.
  });

  it("PriceFeedDecimals", async function() {
    assert.equal(lpPriceFeed.getPriceFeedDecimals(), priceFeedDecimals);
  });

  it("BlockFinder correctly passed in", async function() {
    const blockFinder = BlockFinder(() => {
      throw "err";
    }); // BlockFinder should throw immediately.

    lpPriceFeed = new LPPriceFeed({
      logger: dummyLogger,
      web3,
      getTime: () => mockTime,
      erc20Abi: ERC20Interface.abi,
      tokenAddress: token.address,
      poolAddress: pool.address,
      priceFeedDecimals,
      blockFinder
    });

    await lpPriceFeed.update();
    // Blockfinder is used to grab a historical price. Should throw.
    assert.isTrue(await lpPriceFeed.getHistoricalPrice(100).catch(() => true));
  });
});
