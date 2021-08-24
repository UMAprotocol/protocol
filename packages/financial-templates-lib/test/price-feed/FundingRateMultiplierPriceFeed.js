const winston = require("winston");

const { FundingRateMultiplierPriceFeed } = require("../../src/price-feed/FundingRateMultiplierPriceFeed");
const { advanceBlockAndSetTime, parseFixed } = require("@uma/common");
const { BlockFinder } = require("../../src/price-feed/utils");
const { getTruffleContract } = require("@uma/core");

const PerpetualMock = getTruffleContract("PerpetualMock", web3);
const Perpetual = getTruffleContract("Perpetual", web3);
const MulticallMock = getTruffleContract("MulticallMock", web3);

contract("FundingRateMultiplierPriceFeed.js", function () {
  let perpetualMock;
  let multicallMock;
  let fundingRateMultiplierPriceFeed;
  let mockTime = 0;
  let dummyLogger;
  let priceFeedDecimals = 8;

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

  beforeEach(async function () {
    perpetualMock = await PerpetualMock.new();
    multicallMock = await MulticallMock.new();

    dummyLogger = winston.createLogger({ level: "info", transports: [new winston.transports.Console()] });

    fundingRateMultiplierPriceFeed = new FundingRateMultiplierPriceFeed({
      logger: dummyLogger,
      perpetualAbi: Perpetual.abi,
      perpetualAddress: perpetualMock.address,
      multicallAddress: multicallMock.address,
      web3,
      getTime: () => mockTime,
      priceFeedDecimals,
    });
  });

  it("Basic current price", async function () {
    await perpetualMock.setFundingRate(createFundingRateStructWithMultiplier(parseFixed("0.9", 18).toString()));
    await fundingRateMultiplierPriceFeed.update();

    assert.equal(
      fundingRateMultiplierPriceFeed.getCurrentPrice().toString(),
      parseFixed("0.9", priceFeedDecimals).toString()
    );
  });

  it("Correctly selects most recent price", async function () {
    await perpetualMock.setFundingRate(createFundingRateStructWithMultiplier(parseFixed("0.9", 18).toString()));
    await perpetualMock.setFundingRate(createFundingRateStructWithMultiplier(parseFixed("0.7", 18).toString()));
    await perpetualMock.setFundingRate(createFundingRateStructWithMultiplier(parseFixed("0.05", 18).toString()));
    await fundingRateMultiplierPriceFeed.update();

    assert.equal(
      fundingRateMultiplierPriceFeed.getCurrentPrice().toString(),
      parseFixed("0.05", priceFeedDecimals).toString()
    );
  });

  it("Historical Price", async function () {
    await fundingRateMultiplierPriceFeed.update();

    await perpetualMock.setFundingRate(createFundingRateStructWithMultiplier(parseFixed("0.9", 18).toString()));

    // Ensure that the next block is mined at a later time.
    const { timestamp: firstPriceTimestamp } = await web3.eth.getBlock("latest");
    await advanceBlockAndSetTime(web3, firstPriceTimestamp + 10);

    await perpetualMock.setFundingRate(createFundingRateStructWithMultiplier(parseFixed("0.7", 18).toString()));

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
    await perpetualMock.setFundingRate(createFundingRateStructWithMultiplier(parseFixed("0.9", 18).toString()));
    await fundingRateMultiplierPriceFeed.update();
    assert.equal(
      fundingRateMultiplierPriceFeed.getCurrentPrice().toString(),
      parseFixed("0.9", priceFeedDecimals).toString()
    );
    const initialTime = mockTime;
    assert.equal(fundingRateMultiplierPriceFeed.getLastUpdateTime(), initialTime);

    // Increment time to just under the 1 minute default threshold and push a new price.
    mockTime += 59;
    await perpetualMock.setFundingRate(createFundingRateStructWithMultiplier(parseFixed("0.7", 18).toString()));
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
    const blockFinder = BlockFinder(() => {
      throw "err";
    }); // BlockFinder should throw immediately.
    fundingRateMultiplierPriceFeed = new FundingRateMultiplierPriceFeed({
      logger: dummyLogger,
      web3,
      getTime: () => mockTime,
      perpetualAbi: Perpetual.abi,
      perpetualAddress: perpetualMock.address,
      multicallAddress: multicallMock.address,
      priceFeedDecimals,
      blockFinder,
    });

    await fundingRateMultiplierPriceFeed.update();
    // Blockfinder is used to grab a historical price. Should throw.
    assert.isTrue(await fundingRateMultiplierPriceFeed.getHistoricalPrice(100).catch(() => true));
  });

  it("Multicall", async function () {
    // Funding rate multiplier starts at one, but should be multiplied by 0.8 on a call to applyFundingRate.
    await perpetualMock.setFundingRate(
      createFundingRateStructWithMultiplier(parseFixed("1", 18).toString(), web3.utils.toWei("-.2"))
    );
    await fundingRateMultiplierPriceFeed.update();

    assert.equal(
      fundingRateMultiplierPriceFeed.getCurrentPrice().toString(),
      parseFixed("0.8", priceFeedDecimals).toString()
    );
  });
});
