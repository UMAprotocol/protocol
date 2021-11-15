const { web3, getContract } = require("hardhat");
const { assert } = require("chai");
const winston = require("winston");

const { LPPriceFeed } = require("../../dist/price-feed/LPPriceFeed");
const { advanceBlockAndSetTime, parseFixed } = require("@uma/common");
const { BlockFinder } = require("../../dist/price-feed/utils");

const ERC20Interface = getContract("IERC20Standard");
const ERC20 = getContract("ExpandedERC20");

describe("LPPriceFeed.js", function () {
  let owner, accounts;

  let pool;
  let token;
  let lpPriceFeed;
  let mockTime = 0;
  let dummyLogger;
  let poolDecimals = 18;
  let tokenDecimals = 8;
  let priceFeedDecimals = 12;

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner] = accounts;
  });

  beforeEach(async function () {
    pool = await ERC20.new("LP Pool", "LP", poolDecimals).send({ from: owner });
    token = await ERC20.new("Test Token", "TT", tokenDecimals).send({ from: owner });
    pool.methods.addMinter(owner).send({ from: owner });
    token.methods.addMinter(owner).send({ from: owner });

    dummyLogger = winston.createLogger({ level: "info", transports: [new winston.transports.Console()] });

    lpPriceFeed = new LPPriceFeed({
      logger: dummyLogger,
      web3,
      getTime: () => mockTime,
      erc20Abi: ERC20Interface.abi,
      tokenAddress: token.options.address,
      poolAddress: pool.options.address,
      priceFeedDecimals,
    });
  });

  it("Basic current price", async function () {
    await pool.methods.mint(owner, parseFixed("100", poolDecimals)).send({ from: owner });
    await token.methods.mint(pool.options.address, parseFixed("25", tokenDecimals)).send({ from: owner });
    await lpPriceFeed.update();

    assert.equal(lpPriceFeed.getCurrentPrice().toString(), parseFixed("0.25", priceFeedDecimals).toString());
  });

  it("Correctly selects most recent price", async function () {
    await pool.methods.mint(owner, parseFixed("100", poolDecimals)).send({ from: owner });
    await token.methods.mint(pool.options.address, parseFixed("25", tokenDecimals)).send({ from: owner });
    await pool.methods.mint(owner, parseFixed("100", poolDecimals)).send({ from: owner });
    await lpPriceFeed.update();

    assert.equal(lpPriceFeed.getCurrentPrice().toString(), parseFixed("0.125", priceFeedDecimals).toString());
  });

  it("Historical Price", async function () {
    await pool.methods.mint(owner, parseFixed("100", poolDecimals)).send({ from: owner });
    await token.methods.mint(pool.options.address, parseFixed("25", tokenDecimals)).send({ from: owner });

    await lpPriceFeed.update();

    // Ensure that the next block is mined at a later time.
    const { timestamp: firstPriceTimestamp } = await web3.eth.getBlock("latest");
    await advanceBlockAndSetTime(web3, firstPriceTimestamp + 10);

    await pool.methods.mint(owner, parseFixed("100", poolDecimals)).send({ from: owner });

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

  it("Zero LP shares", async function () {
    await token.methods.mint(pool.options.address, parseFixed("25", tokenDecimals)).send({ from: owner });

    await lpPriceFeed.update();

    assert.equal(lpPriceFeed.getCurrentPrice().toString(), "0");
  });

  it("Update Frequency", async function () {
    await pool.methods.mint(owner, parseFixed("1", poolDecimals)).send({ from: owner });
    await token.methods.mint(pool.options.address, parseFixed("50", tokenDecimals)).send({ from: owner });
    await lpPriceFeed.update();
    assert.equal(lpPriceFeed.getCurrentPrice().toString(), parseFixed("50", priceFeedDecimals).toString());
    const initialTime = mockTime;
    assert.equal(lpPriceFeed.getLastUpdateTime(), initialTime);

    // Increment time to just under the 1 minute default threshold and push a new price.
    mockTime += 59;
    await pool.methods.mint(owner, parseFixed("4", poolDecimals)).send({ from: owner });
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

  it("PriceFeedDecimals", async function () {
    assert.equal(lpPriceFeed.getPriceFeedDecimals(), priceFeedDecimals);
  });

  it("BlockFinder correctly passed in", async function () {
    const blockFinder = new BlockFinder(() => {
      throw "err";
    }); // BlockFinder should throw immediately.

    lpPriceFeed = new LPPriceFeed({
      logger: dummyLogger,
      web3,
      getTime: () => mockTime,
      erc20Abi: ERC20Interface.abi,
      tokenAddress: token.options.address,
      poolAddress: pool.options.address,
      priceFeedDecimals,
      blockFinder,
    });

    await lpPriceFeed.update();
    // Blockfinder is used to grab a historical price. Should throw.
    assert.isTrue(await lpPriceFeed.getHistoricalPrice(100).catch(() => true));
  });
});
