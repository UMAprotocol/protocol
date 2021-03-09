import { web3, assert } from "hardhat";

const { toWei, toBN, fromWei } = web3.utils;

const { getTruffleContract } = require("@uma/core");

// Script to test
const { RangeTrader } = require("../src/RangeTrader");

// Helper scripts
const { createExchangeAdapter } = require("../src/exchange-adapters/CreateExchangeAdapter");

const UniswapBroker = getTruffleContract("UniswapBroker");
const Token = getTruffleContract("ExpandedERC20", web3);
const WETH9 = getTruffleContract("WETH9", web3);
const DSProxyFactory = getTruffleContract("DSProxyFactory", web3, "latest");
const DSProxy = getTruffleContract("DSProxy", web3, "latest");

// Helper Contracts
const UniswapV2Factory = require("@uniswap/v2-core/build/UniswapV2Factory.json");
const IUniswapV2Pair = require("@uniswap/v2-core/build/IUniswapV2Pair.json");
const UniswapV2Router02 = require("@uniswap/v2-periphery/build/UniswapV2Router02.json");

const winston = require("winston");
const sinon = require("sinon");
const {
  SpyTransport,
  spyLogIncludes,
  PriceFeedMock,
  DSProxyManager,
  GasEstimator,
  UniswapPriceFeed
} = require("@uma/financial-templates-lib");

let accounts: string[];
let deployer: string;
let trader: string;
let externalTrader: string;
let traderDSProxyAddress: string;
let spyLogger: any;
let spy: any;
let gasEstimator: any;
let rangeTrader: any;
let tokenPriceFeed: any;
let referencePriceFeed: any;
let dsProxyManager: any;
let exchangeAdapter: any;
let mockTime: any = 0;

let tokenA: any;
let tokenB: any;
let uniswapFactory: any;
let uniswapRouter: any;
let uniswapBroker: any;
let pair: any;
let pairAddress: any;
let WETH: any;
let dsProxyFactory: any;

// Takes in a json object from a compiled contract and returns a truffle contract instance that can be deployed.
// TODO: these methods are taken from the UniswapBroker tests verbatim. they should be refactored to a common util that
// can be re-used between different uniswap tests.
const createContractObjectFromJson = (contractJsonObject: any) => {
  const contract = require("@truffle/contract");
  const truffleContractCreator = contract(contractJsonObject);
  truffleContractCreator.setProvider(web3.currentProvider);
  return truffleContractCreator;
};

// Returns the current spot price of a uniswap pool, scaled to 4 decimal points.
const getPoolSpotPrice = async () => {
  const poolTokenABallance = await tokenA.balanceOf(pairAddress);
  const poolTokenBBallance = await tokenB.balanceOf(pairAddress);
  return Number(fromWei(poolTokenABallance.mul(toBN(toWei("1"))).div(poolTokenBBallance))).toFixed(4);
};

describe("index.js", function() {
  before(async function() {
    accounts = await web3.eth.getAccounts();
    deployer = accounts[0];
    trader = accounts[1];
    externalTrader = accounts[2];

    dsProxyFactory = await DSProxyFactory.new();

    WETH = await WETH9.new();
    // deploy Uniswap V2 Factory & router.
    uniswapFactory = await createContractObjectFromJson(UniswapV2Factory).new(deployer, { from: deployer });
    uniswapRouter = await createContractObjectFromJson(UniswapV2Router02).new(uniswapFactory.address, WETH.address, {
      from: deployer
    });

    // create a uniswapBroker
    uniswapBroker = await UniswapBroker.new();
  });

  beforeEach(async function() {
    // deploy traded tokens
    tokenA = await Token.new("TokenA", "TA", 18);
    tokenB = await Token.new("TokenB", "TB", 18);

    await tokenA.addMember(1, deployer, { from: deployer });
    await tokenB.addMember(1, deployer, { from: deployer });

    // initialize the Uniswap pair
    await uniswapFactory.createPair(tokenA.address, tokenB.address, { from: deployer });
    pairAddress = await uniswapFactory.getPair(tokenA.address, tokenB.address);
    pair = await createContractObjectFromJson(IUniswapV2Pair).at(pairAddress);

    // Create a sinon spy and give it to the SpyTransport as the winston logger. Use this to check all winston logs.
    spy = sinon.spy(); // Create a new spy for each test.
    spyLogger = winston.createLogger({
      level: "debug",
      transports: [new SpyTransport({ level: "debug" }, { spy: spy })]
    });

    // Create the components needed for the RangeTrader. Create a "real" uniswap price feed, with the twapLength &
    // historicalLookback set to 1 such the the twap will update very quickly.
    tokenPriceFeed = new UniswapPriceFeed(
      spyLogger,
      IUniswapV2Pair.abi,
      Token.abi,
      web3,
      pairAddress,
      1,
      1,
      () => mockTime,
      false
    );
    referencePriceFeed = new PriceFeedMock(undefined, undefined, undefined, 18);

    gasEstimator = new GasEstimator(spyLogger);

    dsProxyManager = new DSProxyManager({
      logger: spyLogger,
      web3,
      gasEstimator,
      account: trader,
      dsProxyFactoryAddress: dsProxyFactory.address,
      dsProxyFactoryAbi: DSProxyFactory.abi,
      dsProxyAbi: DSProxy.abi
    });

    // Deploy a new DSProxy
    await dsProxyManager.initializeDSProxy();

    traderDSProxyAddress = dsProxyManager.getDSProxyAddress();

    const exchangeAdapterConfig = {
      type: "uniswap",
      tokenAAddress: tokenA.address,
      tokenBAddress: tokenB.address,
      uniswapRouterAddress: uniswapRouter.address,
      uniswapFactoryAddress: uniswapFactory.address
    };

    exchangeAdapter = await createExchangeAdapter(spyLogger, web3, dsProxyManager, exchangeAdapterConfig);

    // run the tests with no configs provided. Defaults to tradeExecutionThreshold = 5% and targetPriceSpread =5%
    rangeTrader = new RangeTrader(spyLogger, web3, tokenPriceFeed, referencePriceFeed, exchangeAdapter, null);

    // Seed the dsProxy wallet.
    await tokenA.mint(traderDSProxyAddress, toWei("100000000000000"));
    await tokenB.mint(traderDSProxyAddress, toWei("100000000000000"));

    // Seed the externalTrader who is used to move the market around.
    await tokenA.mint(externalTrader, toWei("100000000000000"));
    await tokenB.mint(externalTrader, toWei("100000000000000"));
    await tokenA.approve(uniswapRouter.address, toWei("100000000000000"), {
      from: externalTrader
    });
    await tokenB.approve(uniswapRouter.address, toWei("100000000000000"), {
      from: externalTrader
    });

    // For these test, say the synthetic starts trading at uniswap at 1000 TokenA/TokenB. To set this up we will seed the
    // pair with 1000x units of TokenA, relative to TokenB.
    await tokenA.mint(pairAddress, toBN(toWei("1000")).muln(10000000));
    await tokenB.mint(pairAddress, toBN(toWei("1")).muln(10000000));
    await pair.sync({ from: deployer });
    mockTime = Number((await web3.eth.getBlock("latest")).timestamp) + 1;
    referencePriceFeed.setCurrentPrice(toWei("1000"));
    await tokenPriceFeed.update();
  });

  it("Correctly detects overpriced tokens and executes trades", async function() {
    // The default behavior of the bot is to preform a trade if and only if the absolute error is greater than 20%. If
    //  it is then trade the error down to 5%. To start with, the tokenPriceFeed and referencePriceFeed should both
    // equal 1000, due to the seeing, where no trading should be done as no error between the feeds.
    assert.equal(await getPoolSpotPrice(), "1000.0000"); // price should be exactly 1000 TokenA/TokenB.
    await tokenPriceFeed.update();
    assert.equal(tokenPriceFeed.getLastBlockPrice(), toWei("1000"));
    assert.equal(tokenPriceFeed.getCurrentPrice(), toWei("1000"));
    assert.equal(referencePriceFeed.getCurrentPrice(), toWei("1000"));

    let blockNumberBefore = await web3.eth.getBlockNumber();
    await rangeTrader.checkRangeMovementsAndTrade();
    assert.equal(await web3.eth.getBlockNumber(), blockNumberBefore); // the block number should be the same as no trades done.
    assert.isTrue(spyLogIncludes(spy, -2, "Checking if the priceFeed error exceeds the threshold"));
    assert.isTrue(spyLogIncludes(spy, -1, "less than the threshold to execute a trade"));

    // Next, assume someone trades the synthetic up to a price, thereby introducing an error in the price larger
    // than the tradeExecutionThreshold. We should expect to see the bot: 1) log this accordingly 2) execute a trade via
    // the DSProxy manager 3) the resultant price being equal to the desired targetPriceSpread.

    // For this trade, swap a large number of tokenA into the pool for token B. This should push up the price. A trade of
    // 1.5 billion token B should increase the price by ~ 321 USD, resiting in a price of ~1351
    await uniswapRouter.swapExactTokensForTokens(
      toBN(toWei("1500000000")), // amountIn. We are selling tokenA for tokenB, therefore tokenA is "in" and tokenB is "out"
      0, // amountOutMin
      [tokenA.address, tokenB.address], // path. We are trading from tokenA to tokenB (selling A for B)
      externalTrader, // recipient of the trade
      Number((await web3.eth.getBlock("latest")).timestamp) + 10, // deadline
      { from: externalTrader }
    );

    // Double check the market moved correctly and that the uniswap Price feed correctly reports the price.
    const currentSpotPrice = Number(await getPoolSpotPrice());
    assert.isTrue(currentSpotPrice > 1320 && currentSpotPrice < 1325);
    mockTime = Number((await web3.eth.getBlock("latest")).timestamp) + 1;
    await tokenPriceFeed.update();
    assert.equal(Number(fromWei(tokenPriceFeed.getCurrentPrice())).toFixed(4), currentSpotPrice.toString());

    // Next, execute the bot's trading method and ensure the trade is executed as expected. Note that the default
    // config for the bot is to try and trade the price back to within 5% of the reference price. After this trade the
    // spot price should be 1050.
    blockNumberBefore = await web3.eth.getBlockNumber();
    await rangeTrader.checkRangeMovementsAndTrade();
    assert.equal(await web3.eth.getBlockNumber(), blockNumberBefore + 1); // The block number should have been incremented by 1 as a trade was done

    // Validate that the correct log messages were produced.
    assert.isTrue(spyLogIncludes(spy, -5, "Checking if the priceFeed error exceeds the threshold"));
    assert.isTrue(spyLogIncludes(spy, -4, "The deviationError is greater than the threshold to execute a trade"));
    assert.isTrue(spyLogIncludes(spy, -3, "Executing function on library"));
    assert.isTrue(spyLogIncludes(spy, -2, "Executed function on a freshly deployed library"));
    assert.isTrue(spyLogIncludes(spy, -1, "Exchange adapter has executed a trade successfully"));

    // Validate the last message contains the right spot price and deviation error.
    const latestWinstonLog = spy.getCall(-1).lastArg;
    // The resultant spot price within the log message should correctly embed the expected price of 1050.
    assert.equal(parseFloat(latestWinstonLog.postTradeSpotPrice.replace(",", "")).toFixed(0), "1050");
    // The postTradePriceDeviationError compares the final spot price with the desired reference price. The threshold is
    // set to 5% by default and so we should expect this error to be ~5%.
    assert.equal(parseFloat(latestWinstonLog.postTradePriceDeviationError.replace("%", "")).toFixed(0), "5");
    // The default configuration for the range trader bot is to trade the price back to 5% off the current reference price.
    // Seeing the reference price is set to 1000, the pool price should now be set to 1050 exactly after the correcting trade.
    assert.equal(Number(await getPoolSpotPrice()).toFixed(0), "1050");
    // Equally, the price in the uniswap feed should report a price of 1050.
    mockTime = Number((await web3.eth.getBlock("latest")).timestamp) + 1;
    await tokenPriceFeed.update();
    assert.equal(Number(fromWei(tokenPriceFeed.getLastBlockPrice())).toFixed(4), await getPoolSpotPrice());

    // If the checkRangeMovementsAndTrade is called again no trade should occur as the deviation error is less than 20%.
    blockNumberBefore = await web3.eth.getBlockNumber();
    await rangeTrader.checkRangeMovementsAndTrade();
    assert.equal(await web3.eth.getBlockNumber(), blockNumberBefore); // the block number should be the same as no trades done.
    assert.isTrue(spyLogIncludes(spy, -2, "Checking if the priceFeed error exceeds the threshold"));
    assert.isTrue(spyLogIncludes(spy, -1, "less than the threshold to execute a trade"));
  });
  it("Correctly detects underpriced tokens and executes trades", async function() {
    // This test is very similar to the previous one but instead of setting the synth to be overpriced we set to to
    // underpriced. To get directly to the test case we can simply set the reference price feed to be greater than the
    // synthetic dex price + the threshold. Any price for the reference feed over 1250 should trigger a trade as the %
    // error is calculated using δ = (observed - expected) / expected where δ = (1000 - 1250) / 1250 = 0.2. If we set it
    // to 1249 we should not execute a trade as the price is right below the execution threshold of 20%.
    referencePriceFeed.setCurrentPrice(toWei("1249"));
    let blockNumberBefore = await web3.eth.getBlockNumber();
    await rangeTrader.checkRangeMovementsAndTrade();
    assert.equal(await web3.eth.getBlockNumber(), blockNumberBefore); // The block number should not have incremented as no trade.
    assert.isTrue(spyLogIncludes(spy, -2, "Checking if the priceFeed error exceeds the threshold"));
    assert.isTrue(spyLogIncludes(spy, -1, "less than the threshold to execute a trade"));

    // However, a price of 1250 is exactly on the threshold and we should see a trade.
    referencePriceFeed.setCurrentPrice(toWei("1250"));
    blockNumberBefore = await web3.eth.getBlockNumber();
    await rangeTrader.checkRangeMovementsAndTrade();
    assert.equal(await web3.eth.getBlockNumber(), blockNumberBefore + 1); // The block number should have incremented due to the trade.

    // Validate that the correct log messages were produced.
    assert.isTrue(spyLogIncludes(spy, -5, "Checking if the priceFeed error exceeds the threshold"));
    assert.isTrue(spyLogIncludes(spy, -4, "The deviationError is greater than the threshold to execute a trade"));
    assert.isTrue(spyLogIncludes(spy, -3, "Executing function on library"));
    assert.isTrue(spyLogIncludes(spy, -2, "Executed function on a freshly deployed library"));
    assert.isTrue(spyLogIncludes(spy, -1, "Exchange adapter has executed a trade successfully"));

    // The spot price should be set to 5% below the reference price feed as the bot was trading up from the previous number.
    // This yields 1250*0.95 ~= 1187 as the expected market price.
    assert.equal(Number(await getPoolSpotPrice()).toFixed(0), "1187");
    // Check that the resultant post Trade Price Deviation is -5%, as we should be 5% below the reference price after the trade.
    assert.equal(parseFloat(spy.getCall(-1).lastArg.postTradePriceDeviationError.replace("%", "")).toFixed(0), "-5");
  });

  it("Correctly rejects invalid config and params", async function() {
    // tradeExecutionThreshold should only be strictly larger than 0.

    assert.throws(() => {
      new RangeTrader(spyLogger, web3, tokenPriceFeed, referencePriceFeed, exchangeAdapter, {
        tradeExecutionThreshold: -1
      });
    });
    assert.throws(() => {
      new RangeTrader(spyLogger, web3, tokenPriceFeed, referencePriceFeed, exchangeAdapter, {
        tradeExecutionThreshold: 0
      });
    });

    // targetPriceSpread should only be larger than 0 and smaller than or equal to 1.
    assert.throws(() => {
      new RangeTrader(spyLogger, web3, tokenPriceFeed, referencePriceFeed, exchangeAdapter, {
        targetPriceSpread: -1
      });
    });
    assert.throws(() => {
      new RangeTrader(spyLogger, web3, tokenPriceFeed, referencePriceFeed, exchangeAdapter, {
        targetPriceSpread: 0
      });
    });
    assert.throws(() => {
      new RangeTrader(spyLogger, web3, tokenPriceFeed, referencePriceFeed, exchangeAdapter, {
        targetPriceSpread: 1.1
      });
    });

    // rejects inconsistent price feed decimals
    const nonStandardDecimalPriceFeed = new PriceFeedMock(undefined, undefined, undefined, 17);
    assert.throws(() => {
      new RangeTrader(spyLogger, web3, nonStandardDecimalPriceFeed, referencePriceFeed, exchangeAdapter);
    });
  });
  it("Correctly respects custom trade threshold configs", async function() {
    const customRangeTrader = new RangeTrader(spyLogger, web3, tokenPriceFeed, referencePriceFeed, exchangeAdapter, {
      tradeExecutionThreshold: 0.5, // Only trade if price greater than 50%.
      targetPriceSpread: 0.2 // Trade price back to within 20% of the "true" price.
    });

    assert.equal(customRangeTrader.tradeExecutionThreshold, 0.5);
    assert.equal(customRangeTrader.targetPriceSpread, 0.2);
  });
});
