import winston from "winston";
import sinon from "sinon";
import hre from "hardhat";
import type { HRE } from "@uma/common";
const { web3, getContract } = hre as HRE;
import { assert } from "chai";
const { toWei, toBN, fromWei } = web3.utils;

import {
  SpyTransport,
  spyLogIncludes,
  PriceFeedMock,
  DSProxyManager,
  GasEstimator,
  UniswapV2PriceFeed,
} from "@uma/financial-templates-lib";
import { createContractObjectFromJson } from "@uma/common";

// Script to test
import { RangeTrader } from "../src/RangeTrader";

// Helper scripts
import { createExchangeAdapter } from "../src/exchange-adapters/CreateExchangeAdapter";

const Token = getContract("ExpandedERC20");
const WETH9 = getContract("WETH9");
const DSProxyFactory = getContract("DSProxyFactory");
const DSProxy = getContract("DSProxy");

// Helper Contracts
import UniswapV2Factory from "@uniswap/v2-core/build/UniswapV2Factory.json";
import IUniswapV2Pair from "@uniswap/v2-core/build/IUniswapV2Pair.json";
import UniswapV2Router02 from "@uniswap/v2-periphery/build/UniswapV2Router02.json";

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
let pair: any;
let pairAddress: any;
let WETH: any;
let dsProxyFactory: any;

// Returns the current spot price of a uniswap pool, scaled to 4 decimal points.
const getPoolSpotPrice = async () => {
  const poolTokenABalance = toBN(await tokenA.methods.balanceOf(pairAddress).call());
  const poolTokenBBalance = toBN(await tokenB.methods.balanceOf(pairAddress).call());
  return Number(fromWei(poolTokenABalance.mul(toBN(toWei("1"))).div(poolTokenBBalance))).toFixed(4);
};

describe("UniswapV2Trader.js", function () {
  before(async function () {
    accounts = await web3.eth.getAccounts();
    deployer = accounts[0];
    trader = accounts[1];
    externalTrader = accounts[2];

    dsProxyFactory = await DSProxyFactory.new().send({ from: deployer });

    WETH = await WETH9.new().send({ from: deployer });
    // deploy Uniswap V2 Factory & router.
    uniswapFactory = (await createContractObjectFromJson(UniswapV2Factory, web3).new(deployer, { from: deployer }))
      .contract;
    uniswapRouter = (
      await createContractObjectFromJson(UniswapV2Router02, web3).new(
        uniswapFactory.options.address,
        WETH.options.address,
        { from: deployer }
      )
    ).contract;
  });

  beforeEach(async function () {
    // deploy traded tokens
    tokenA = await Token.new("TokenA", "TA", 18).send({ from: deployer });
    tokenB = await Token.new("TokenB", "TB", 18).send({ from: deployer });
    if (tokenA.options.address.toLowerCase() < tokenB.options.address.toLowerCase())
      [tokenA, tokenB] = [tokenB, tokenA];

    await tokenA.methods.addMember(1, deployer).send({ from: deployer });
    await tokenB.methods.addMember(1, deployer).send({ from: deployer });

    // initialize the Uniswap pair
    await uniswapFactory.methods.createPair(tokenA.options.address, tokenB.options.address).send({ from: deployer });
    pairAddress = await uniswapFactory.methods.getPair(tokenA.options.address, tokenB.options.address).call();
    pair = (await createContractObjectFromJson(IUniswapV2Pair, web3).at(pairAddress)).contract;

    // Create a sinon spy and give it to the SpyTransport as the winston logger. Use this to check all winston logs.
    spy = sinon.spy(); // Create a new spy for each test.
    spyLogger = winston.createLogger({
      level: "debug",
      transports: [new SpyTransport({ level: "debug" }, { spy: spy })],
    });

    // Literals are not inferred from JSON.
    type UniswapAbiElement = typeof IUniswapV2Pair.abi[number] & { type: "event" | "function" } & {
      stateMutability?: "view" | "payable" | "pure";
    };

    // Create the components needed for the RangeTrader. Create a "real" uniswap price feed, with the twapLength &
    // historicalLookback set to 1 such the the twap will update very quickly.
    tokenPriceFeed = new UniswapV2PriceFeed(
      spyLogger, // logger
      IUniswapV2Pair.abi as UniswapAbiElement[], // uniswapABI
      Token.abi, // erc20Abi
      web3,
      pairAddress,
      1, // twapLength
      1, // historicalLookback
      () => mockTime, // getTime
      false // invertprice
    );
    referencePriceFeed = new PriceFeedMock(undefined, undefined, undefined, 18);

    gasEstimator = new GasEstimator(spyLogger);

    dsProxyManager = new DSProxyManager({
      logger: spyLogger,
      web3,
      gasEstimator,
      account: trader,
      dsProxyFactoryAddress: dsProxyFactory.options.address,
      dsProxyFactoryAbi: DSProxyFactory.abi,
      dsProxyAbi: DSProxy.abi,
    });

    // Deploy a new DSProxy
    await dsProxyManager.initializeDSProxy();

    traderDSProxyAddress = dsProxyManager.getDSProxyAddress();

    const exchangeAdapterConfig = {
      type: "uniswap-v2",
      tokenAAddress: tokenA.options.address,
      tokenBAddress: tokenB.options.address,
      uniswapRouterAddress: uniswapRouter.options.address,
      uniswapFactoryAddress: uniswapFactory.options.address,
    };

    exchangeAdapter = await createExchangeAdapter(spyLogger, web3, dsProxyManager, exchangeAdapterConfig, 0);

    // run the tests with no configs provided. Defaults to tradeExecutionThreshold = 5% and targetPriceSpread =5%
    rangeTrader = new RangeTrader(spyLogger, web3, tokenPriceFeed, referencePriceFeed, exchangeAdapter, {});

    // Seed the dsProxy wallet.
    await tokenA.methods.mint(traderDSProxyAddress, toWei("100000000000000")).send({ from: deployer });
    await tokenB.methods.mint(traderDSProxyAddress, toWei("100000000000000")).send({ from: deployer });

    // Seed the externalTrader who is used to move the market around.
    await tokenA.methods.mint(externalTrader, toWei("100000000000000")).send({ from: deployer });
    await tokenB.methods.mint(externalTrader, toWei("100000000000000")).send({ from: deployer });
    await tokenA.methods.approve(uniswapRouter.options.address, toWei("100000000000000")).send({
      from: externalTrader,
    });
    await tokenB.methods.approve(uniswapRouter.options.address, toWei("100000000000000")).send({
      from: externalTrader,
    });

    // For these test, say the synthetic starts trading at uniswap at 1000 TokenA/TokenB. To set this up we will seed the
    // pair with 1000x units of TokenA, relative to TokenB.
    await tokenA.methods.mint(pairAddress, toBN(toWei("1000")).muln(10000000)).send({ from: deployer });
    await tokenB.methods.mint(pairAddress, toBN(toWei("1")).muln(10000000)).send({ from: deployer });
    await pair.methods.sync().send({ from: deployer });
    mockTime = Number((await web3.eth.getBlock("latest")).timestamp) + 1;
    referencePriceFeed.setCurrentPrice(toWei("1000"));
    await tokenPriceFeed.update();
  });

  it("Correctly detects overpriced tokens and executes trades", async function () {
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
    await uniswapRouter.methods
      .swapExactTokensForTokens(
        toBN(toWei("1500000000")), // amountIn. We are selling tokenA for tokenB, therefore tokenA is "in" and tokenB is "out"
        0, // amountOutMin
        [tokenA.options.address, tokenB.options.address], // path. We are trading from tokenA to tokenB (selling A for B)
        externalTrader, // recipient of the trade
        Number((await web3.eth.getBlock("latest")).timestamp) + 10 // deadline
      )
      .send({ from: externalTrader });

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
    await tokenPriceFeed.update();
    assert.equal(await web3.eth.getBlockNumber(), blockNumberBefore + 1); // The block number should have been incremented by 1 as a trade was done

    // Validate that the correct log messages were produced.
    assert.isTrue(spyLogIncludes(spy, -6, "Checking if the priceFeed error exceeds the threshold"));
    assert.isTrue(spyLogIncludes(spy, -5, "The deviationError is greater than the threshold to execute a trade"));
    assert.isTrue(spyLogIncludes(spy, -4, "Executing function on library"));
    assert.isTrue(spyLogIncludes(spy, -3, "Gas estimator"));
    assert.isTrue(spyLogIncludes(spy, -2, "Executed function on a freshly deployed library"));
    assert.isTrue(spyLogIncludes(spy, -1, "exchange adapter has executed a trade successfully"));

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
  it("Correctly detects underpriced tokens and executes trades", async function () {
    // This test is very similar to the previous one but instead of setting the synth to be overpriced we set to to
    // underpriced. To get directly to the test case we can simply set the reference price feed to be greater than the
    // synthetic dex price + the threshold. Any price for the reference feed over 1250 should trigger a trade as the %
    // error is calculated using δ = (observed - expected) / expected where δ = (1000 - 1250) / 1250 = 0.2. If we set it
    // to 1249 we should not execute a trade as the price is right below the execution threshold of 20%.

    // First, double check everything is set correctly to start with.
    assert.equal(await getPoolSpotPrice(), "1000.0000"); // price should be exactly 1000 TokenA/TokenB before any trades.
    await tokenPriceFeed.update();
    assert.equal(tokenPriceFeed.getLastBlockPrice().toString(), toWei("1000"));
    assert.equal(tokenPriceFeed.getCurrentPrice(), toWei("1000"));
    assert.equal(referencePriceFeed.getCurrentPrice(), toWei("1000"));

    // Move the price to just below the threshold and ensure no trade.
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
    assert.isTrue(spyLogIncludes(spy, -6, "Checking if the priceFeed error exceeds the threshold"));
    assert.isTrue(spyLogIncludes(spy, -5, "The deviationError is greater than the threshold to execute a trade"));
    assert.isTrue(spyLogIncludes(spy, -4, "Executing function on library"));
    assert.isTrue(spyLogIncludes(spy, -3, "Gas estimator"));
    assert.isTrue(spyLogIncludes(spy, -2, "Executed function on a freshly deployed library"));
    assert.isTrue(spyLogIncludes(spy, -1, "exchange adapter has executed a trade successfully"));

    // The spot price should be set to 5% below the reference price feed as the bot was trading up from the previous number.
    // This yields 1250*0.95 ~= 1187 as the expected market price.
    assert.equal(Number(await getPoolSpotPrice()).toFixed(0), "1187");
    // Check that the resultant post Trade Price Deviation is -5%, as we should be 5% below the reference price after the trade.
    assert.equal(parseFloat(spy.getCall(-1).lastArg.postTradePriceDeviationError.replace("%", "")).toFixed(0), "-5");
  });

  it("Correctly rejects invalid config and params", async function () {
    // tradeExecutionThreshold should only be strictly larger than 0.

    assert.throws(() => {
      new RangeTrader(spyLogger, web3, tokenPriceFeed, referencePriceFeed, exchangeAdapter, {
        tradeExecutionThreshold: -1,
      });
    });
    assert.throws(() => {
      new RangeTrader(spyLogger, web3, tokenPriceFeed, referencePriceFeed, exchangeAdapter, {
        tradeExecutionThreshold: 0,
      });
    });

    // targetPriceSpread should only be larger than 0 and smaller than or equal to 1.
    assert.throws(() => {
      new RangeTrader(spyLogger, web3, tokenPriceFeed, referencePriceFeed, exchangeAdapter, { targetPriceSpread: -1 });
    });
    assert.throws(() => {
      new RangeTrader(spyLogger, web3, tokenPriceFeed, referencePriceFeed, exchangeAdapter, { targetPriceSpread: 0 });
    });
    assert.throws(() => {
      new RangeTrader(spyLogger, web3, tokenPriceFeed, referencePriceFeed, exchangeAdapter, { targetPriceSpread: 1.1 });
    });

    // rejects inconsistent price feed decimals
    const nonStandardDecimalPriceFeed = new PriceFeedMock(undefined, undefined, undefined, 17);
    assert.throws(() => {
      new RangeTrader(spyLogger, web3, nonStandardDecimalPriceFeed, referencePriceFeed, exchangeAdapter, {});
    });
  });
  it("Correctly respects custom trade threshold configs", async function () {
    const customRangeTrader = new RangeTrader(spyLogger, web3, tokenPriceFeed, referencePriceFeed, exchangeAdapter, {
      tradeExecutionThreshold: 0.5, // Only trade if price greater than 50%.
      targetPriceSpread: 0.2, // Trade price back to within 20% of the "true" price.
    });

    assert.equal(customRangeTrader.tradeExecutionThreshold, 0.5);
    assert.equal(customRangeTrader.targetPriceSpread, 0.2);
  });
});
