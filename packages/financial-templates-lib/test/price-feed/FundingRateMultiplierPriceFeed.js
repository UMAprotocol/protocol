const { web3, getContract } = require("hardhat");
const { assert } = require("chai");
const winston = require("winston");

const { FundingRateMultiplierPriceFeed } = require("../../dist/price-feed/FundingRateMultiplierPriceFeed");
const { advanceBlockAndSetTime, parseFixed } = require("@uma/common");
const { BlockFinder } = require("../../dist/price-feed/utils");

const PerpetualMock = getContract("PerpetualMock");
const Perpetual = getContract("Perpetual");
const MulticallMock = getContract("MulticallMock");

describe("FundingRateMultiplierPriceFeed.js", function () {
  let perpetualMock;
  let multicallMock;
  let fundingRateMultiplierPriceFeed;
  let mockTime = 0;
  let dummyLogger;
  let priceFeedDecimals = 8;
  let accounts;

  const createFundingRateStructWithMultiplier = (multiplier, rate = "0") => {
    return {
      rate: { rawValue: rate },
      identifier: web3.utils.padRight("0x1234", 64),
      cumulativeMultiplier: { rawValue: multiplier },
      updateTime: "0",
      applicationTime: "0",
      proposalTime: "0",
      value: "0",
    };
  };

  before(async function () {
    accounts = await web3.eth.getAccounts();
  });

  beforeEach(async function () {
    perpetualMock = await PerpetualMock.new().send({ from: accounts[0] });
    multicallMock = await MulticallMock.new().send({ from: accounts[0] });

    dummyLogger = winston.createLogger({ level: "info", transports: [new winston.transports.Console()] });

    fundingRateMultiplierPriceFeed = new FundingRateMultiplierPriceFeed({
      logger: dummyLogger,
      perpetualAbi: Perpetual.abi,
      perpetualAddress: perpetualMock.options.address,
      multicallAddress: multicallMock.options.address,
      web3,
      getTime: () => mockTime,
      priceFeedDecimals,
    });
  });

  it("Basic current price", async function () {
    await perpetualMock.methods
      .setFundingRate(createFundingRateStructWithMultiplier(parseFixed("0.9", 18).toString()))
      .send({ from: accounts[0] });
    await fundingRateMultiplierPriceFeed.update();

    assert.equal(
      fundingRateMultiplierPriceFeed.getCurrentPrice().toString(),
      parseFixed("0.9", priceFeedDecimals).toString()
    );
  });

  it("Correctly selects most recent price", async function () {
    await perpetualMock.methods
      .setFundingRate(createFundingRateStructWithMultiplier(parseFixed("0.9", 18).toString()))
      .send({ from: accounts[0] });
    await perpetualMock.methods
      .setFundingRate(createFundingRateStructWithMultiplier(parseFixed("0.7", 18).toString()))
      .send({ from: accounts[0] });
    await perpetualMock.methods
      .setFundingRate(createFundingRateStructWithMultiplier(parseFixed("0.05", 18).toString()))
      .send({ from: accounts[0] });
    await fundingRateMultiplierPriceFeed.update();

    assert.equal(
      fundingRateMultiplierPriceFeed.getCurrentPrice().toString(),
      parseFixed("0.05", priceFeedDecimals).toString()
    );
  });

  it("Historical Price", async function () {
    await fundingRateMultiplierPriceFeed.update();

    await perpetualMock.methods
      .setFundingRate(createFundingRateStructWithMultiplier(parseFixed("0.9", 18).toString()))
      .send({ from: accounts[0] });

    // Ensure that the next block is mined at a later time.
    const { timestamp: firstPriceTimestamp } = await web3.eth.getBlock("latest");
    await advanceBlockAndSetTime(web3, firstPriceTimestamp + 10);

    await perpetualMock.methods
      .setFundingRate(createFundingRateStructWithMultiplier(parseFixed("0.7", 18).toString()))
      .send({ from: accounts[0] });

    const { timestamp: secondPriceTimestamp } = await web3.eth.getBlock("latest");

    assert.equal(
      (await fundingRateMultiplierPriceFeed.getHistoricalPrice(firstPriceTimestamp)).toString(),
      parseFixed("0.9", priceFeedDecimals)
    );
    assert.equal(
      (await fundingRateMultiplierPriceFeed.getHistoricalPrice(firstPriceTimestamp + 5)).toString(),
      parseFixed("0.9", priceFeedDecimals)
    );
    assert.equal(
      (await fundingRateMultiplierPriceFeed.getHistoricalPrice(secondPriceTimestamp - 1)).toString(),
      parseFixed("0.9", priceFeedDecimals)
    );
    assert.equal(
      (await fundingRateMultiplierPriceFeed.getHistoricalPrice(secondPriceTimestamp)).toString(),
      parseFixed("0.7", priceFeedDecimals)
    );
  });

  it("Update Frequency", async function () {
    await perpetualMock.methods
      .setFundingRate(createFundingRateStructWithMultiplier(parseFixed("0.9", 18).toString()))
      .send({ from: accounts[0] });
    await fundingRateMultiplierPriceFeed.update();
    assert.equal(
      fundingRateMultiplierPriceFeed.getCurrentPrice().toString(),
      parseFixed("0.9", priceFeedDecimals).toString()
    );
    const initialTime = mockTime;
    assert.equal(fundingRateMultiplierPriceFeed.getLastUpdateTime(), initialTime);

    // Increment time to just under the 1 minute default threshold and push a new price.
    mockTime += 59;
    await perpetualMock.methods
      .setFundingRate(createFundingRateStructWithMultiplier(parseFixed("0.7", 18).toString()))
      .send({ from: accounts[0] });
    await fundingRateMultiplierPriceFeed.update();
    assert.equal(fundingRateMultiplierPriceFeed.getLastUpdateTime(), initialTime); // No change in update time.

    // Price should not have changed.
    assert.equal(
      fundingRateMultiplierPriceFeed.getCurrentPrice().toString(),
      parseFixed("0.9", priceFeedDecimals).toString()
    );

    // An increment of one more secont + update should trigger the feed to pull in the new price.
    mockTime += 1;
    await fundingRateMultiplierPriceFeed.update();
    assert.equal(
      fundingRateMultiplierPriceFeed.getCurrentPrice().toString(),
      parseFixed("0.7", priceFeedDecimals).toString()
    );
    assert.equal(fundingRateMultiplierPriceFeed.getLastUpdateTime(), mockTime); // Update time should have no incremented.
  });

  it("PriceFeedDecimals", async function () {
    assert.equal(fundingRateMultiplierPriceFeed.getPriceFeedDecimals(), priceFeedDecimals);
  });

  it("BlockFinder correctly passed in", async function () {
    const blockFinder = new BlockFinder(() => {
      throw "err";
    }); // BlockFinder should throw immediately.
    fundingRateMultiplierPriceFeed = new FundingRateMultiplierPriceFeed({
      logger: dummyLogger,
      web3,
      getTime: () => mockTime,
      perpetualAbi: Perpetual.abi,
      perpetualAddress: perpetualMock.options.address,
      multicallAddress: multicallMock.options.address,
      priceFeedDecimals,
      blockFinder,
    });

    await fundingRateMultiplierPriceFeed.update();
    // Blockfinder is used to grab a historical price. Should throw.
    assert.isTrue(await fundingRateMultiplierPriceFeed.getHistoricalPrice(100).catch(() => true));
  });

  it("Multicall", async function () {
    // Funding rate multiplier starts at one, but should be multiplied by 0.8 on a call to applyFundingRate.
    await perpetualMock.methods
      .setFundingRate(createFundingRateStructWithMultiplier(parseFixed("1", 18).toString(), web3.utils.toWei("-.2")))
      .send({ from: accounts[0] });
    await fundingRateMultiplierPriceFeed.update();

    assert.equal(
      fundingRateMultiplierPriceFeed.getCurrentPrice().toString(),
      parseFixed("0.8", priceFeedDecimals).toString()
    );
  });
});
