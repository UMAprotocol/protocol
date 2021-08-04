import winston from "winston";
import sinon from "sinon";
import { web3, assert } from "hardhat";
const { toWei, fromWei } = web3.utils;

import { getTruffleContract } from "@uma/core";
import {
  SpyTransport,
  spyLogIncludes,
  PriceFeedMock,
  DSProxyManager,
  GasEstimator,
  UniswapV3PriceFeed,
} from "@uma/financial-templates-lib";

import {
  encodePriceSqrt,
  getTickFromPrice,
  getCurrentPrice,
  encodePath,
  computePoolAddress,
  FeeAmount,
  createContractObjectFromJson,
  replaceLibraryBindingReferenceInArtitifact,
} from "@uma/common";

// Script to test
import { RangeTrader } from "../src/RangeTrader";

// Helper scripts
import { createExchangeAdapter } from "../src/exchange-adapters/CreateExchangeAdapter";

const Token = getTruffleContract("ExpandedERC20", web3 as any);
const WETH9 = getTruffleContract("WETH9", web3 as any);
const DSProxyFactory = getTruffleContract("DSProxyFactory", web3 as any, "latest");
const DSProxy = getTruffleContract("DSProxy", web3 as any, "latest");

// Import all the uniswap related contracts.
import SwapRouter from "@uniswap/v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json";
import NFTDescriptor from "@uniswap/v3-periphery/artifacts/contracts/libraries/NFTDescriptor.sol/NFTDescriptor.json";
import NonfungiblePositionManager from "@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json";
import UniswapV3Factory from "@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json";
import UniswapV3Pool from "@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json";

// NonfungibleTokenPositionDescriptor has a library that needs to be linked. To do this using an artifact imported from
// an external project we need to do a small find and replace within the json artifact.
const NonfungibleTokenPositionDescriptor = replaceLibraryBindingReferenceInArtitifact(
  require("@uniswap/v3-periphery/artifacts/contracts/NonfungibleTokenPositionDescriptor.sol/NonfungibleTokenPositionDescriptor.json"),
  "NFTDescriptor"
);

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
let positionDescriptor: any;
let positionManager: any;
let WETH: any;
let dsProxyFactory: any;
const fee = FeeAmount.MEDIUM;
let poolAddress: any;

describe("uniswapV3Trader.js", function () {
  async function addLiquidityToPool(
    amount0Desired: string,
    amount1Desired: string,
    tickLower: string,
    tickUpper: string
  ) {
    if (tokenA.address.toLowerCase() > tokenB.address.toLowerCase()) [tokenA, tokenB] = [tokenB, tokenA];

    await positionManager.createAndInitializePoolIfNecessary(
      tokenA.address,
      tokenB.address,
      fee,
      encodePriceSqrt(amount0Desired, amount1Desired), // start the pool price at 10 tokenA/tokenB
      { from: trader }
    );

    const liquidityParams = {
      token0: tokenA.address,
      token1: tokenB.address,
      fee,
      tickLower, // Lower tick bound price = 1.0001^tickLower
      tickUpper, // Upper tick bound price = 1.0001^tickUpper
      recipient: trader,
      amount0Desired,
      amount1Desired,
      amount0Min: 0,
      amount1Min: 0,
      deadline: 15798990420, // some number far in the future
    };

    await positionManager.mint(liquidityParams, { from: trader });
    poolAddress = computePoolAddress(uniswapFactory.address, tokenA.address, tokenB.address, fee);
  }

  before(async function () {
    accounts = await web3.eth.getAccounts();
    deployer = accounts[0];
    trader = accounts[1];
    externalTrader = accounts[2];

    dsProxyFactory = await DSProxyFactory.new();

    WETH = await WETH9.new();

    // deploy Uniswap V3 Factory, router, position manager, position descriptor and tickLens.
    uniswapFactory = await createContractObjectFromJson(UniswapV3Factory, web3).new({
      from: deployer,
    });
    uniswapRouter = await createContractObjectFromJson(SwapRouter, web3).new(uniswapFactory.address, WETH.address, {
      from: deployer,
    });

    const PositionDescriptor = createContractObjectFromJson(NonfungibleTokenPositionDescriptor, web3);
    await PositionDescriptor.detectNetwork();

    PositionDescriptor.link(await createContractObjectFromJson(NFTDescriptor, web3).new({ from: deployer }));
    positionDescriptor = await PositionDescriptor.new(WETH.address, { from: deployer });

    positionManager = await createContractObjectFromJson(NonfungiblePositionManager, web3).new(
      uniswapFactory.address,
      WETH.address,
      positionDescriptor.address,
      { from: deployer }
    );
  });

  beforeEach(async function () {
    // deploy traded tokens
    tokenA = await Token.new("TokenA", "TA", 18);
    tokenB = await Token.new("TokenB", "TB", 18);

    await tokenA.addMember(1, deployer, { from: deployer });
    await tokenB.addMember(1, deployer, { from: deployer });

    await tokenA.mint(trader, toWei("100000000000000"));
    await tokenB.mint(trader, toWei("100000000000000"));

    for (const address of [positionManager.address, uniswapRouter.address]) {
      await tokenA.approve(address, toWei("100000000000000"), { from: trader });
      await tokenB.approve(address, toWei("100000000000000"), { from: trader });
    }

    // Create a sinon spy and give it to the SpyTransport as the winston logger. Use this to check all winston logs.
    spy = sinon.spy(); // Create a new spy for each test.
    spyLogger = winston.createLogger({
      level: "debug",
      transports: [new SpyTransport({ level: "debug" }, { spy: spy })],
    });
    referencePriceFeed = new PriceFeedMock(undefined, undefined, undefined, 18);

    // Add some liquidity to the pool to seed it an ensure there is a poolAddress. set starting price to 1000 with
    // the range between 900 and 1100. Additional liquidity tests will be added within unit tests later on.
    await addLiquidityToPool(toWei("1000000"), toWei("1000"), getTickFromPrice(900, fee), getTickFromPrice(1100, fee));

    // execute two tiny trades in either direction to seed the pool with some events so the price feed will work.
    const params = {
      path: encodePath([tokenA.address, tokenB.address], [fee]),
      recipient: trader,
      deadline: 15798990420,
      amountIn: 1,
      amountOutMinimum: 0,
    };
    const params2 = { ...params, amountIn: 10, path: encodePath([tokenB.address, tokenA.address], [fee]) }; // other direction to bring price back to exactly 1000

    await uniswapRouter.exactInput(params, { from: trader });
    await uniswapRouter.exactInput(params2, { from: trader });
    mockTime = Number((await web3.eth.getBlock("latest")).timestamp) + 1;

    referencePriceFeed.setCurrentPrice(toWei("1000"));

    // Create the components needed for the RangeTrader. Create a "real" uniswap price feed, with the twapLength &
    // historicalLookback set to 1 such the the twap will update very quickly.
    tokenPriceFeed = new UniswapV3PriceFeed(
      spyLogger,
      UniswapV3Pool.abi,
      Token.abi,
      web3,
      poolAddress,
      1,
      1,
      () => mockTime,
      false
    );

    gasEstimator = new GasEstimator(spyLogger);

    dsProxyManager = new DSProxyManager({
      logger: spyLogger,
      web3,
      gasEstimator,
      account: trader,
      dsProxyFactoryAddress: dsProxyFactory.address,
      dsProxyFactoryAbi: DSProxyFactory.abi,
      dsProxyAbi: DSProxy.abi,
    });

    // Deploy a new DSProxy
    await dsProxyManager.initializeDSProxy();

    traderDSProxyAddress = dsProxyManager.getDSProxyAddress();

    const exchangeAdapterConfig = {
      type: "uniswap-v3",
      uniswapPoolAddress: poolAddress,
      uniswapRouterAddress: uniswapRouter.address,
    };

    exchangeAdapter = await createExchangeAdapter(spyLogger, web3, dsProxyManager, exchangeAdapterConfig, 0);

    // run the tests with no configs provided. Defaults to tradeExecutionThreshold = 5% and targetPriceSpread =5%
    rangeTrader = new RangeTrader(spyLogger, web3, tokenPriceFeed, referencePriceFeed, exchangeAdapter, {});

    // Seed the dsProxy.
    await tokenA.mint(traderDSProxyAddress, toWei("100000000000000"));
    await tokenB.mint(traderDSProxyAddress, toWei("100000000000000"));

    // Seed the externalTrader who is used to move the market around.
    await tokenA.mint(externalTrader, toWei("100000000000000"));
    await tokenB.mint(externalTrader, toWei("100000000000000"));
    await tokenA.approve(uniswapRouter.address, toWei("100000000000000"), { from: externalTrader });
    await tokenB.approve(uniswapRouter.address, toWei("100000000000000"), { from: externalTrader });

    // Finally, add a bunch of additional liquidity to the pool. Let's add this over a number of ranges to make it as
    // realistic as possible. All LPs add liquidity at a price of 1000 tokenA/tokenB
    await addLiquidityToPool(toWei("100000"), toWei("100"), getTickFromPrice(800, fee), getTickFromPrice(1500, fee));
    await addLiquidityToPool(toWei("100"), toWei("0.10"), getTickFromPrice(990, fee), getTickFromPrice(1010, fee));
    await addLiquidityToPool(toWei("5000"), toWei("5"), getTickFromPrice(500, fee), getTickFromPrice(2000, fee));
    await addLiquidityToPool(toWei("1000"), toWei("1"), getTickFromPrice(1200, fee), getTickFromPrice(1500, fee));
    await addLiquidityToPool(toWei("1000"), toWei("1"), getTickFromPrice(600, fee), getTickFromPrice(800, fee));
    await addLiquidityToPool(toWei("650"), toWei("0.65"), getTickFromPrice(1000, fee), getTickFromPrice(1100, fee));
    await addLiquidityToPool(toWei("650"), toWei("0.65"), getTickFromPrice(850, fee), getTickFromPrice(900, fee));
  });

  it("Correctly detects overpriced tokens and executes trades", async function () {
    // The default behavior of the bot is to preform a trade if and only if the absolute error is greater than 20%. If
    //  it is then trade the error down to 5%. To start with, the tokenPriceFeed and referencePriceFeed should both
    // equal 1000, due to the seeing, where no trading should be done as no error between the feeds.
    assert.equal((await getCurrentPrice(poolAddress, web3)).toNumber(), 1000); // price should be exactly 1000 TokenA/TokenB.

    await tokenPriceFeed.update();
    assert.equal(tokenPriceFeed.getCurrentPrice(), toWei("1000"));
    assert.equal(tokenPriceFeed.getLastBlockPrice().toString(), toWei("1000"));
    assert.equal(referencePriceFeed.getCurrentPrice().toString(), toWei("1000"));

    let blockNumberBefore = await web3.eth.getBlockNumber();
    await rangeTrader.checkRangeMovementsAndTrade();
    assert.equal(await web3.eth.getBlockNumber(), blockNumberBefore); // the block number should be the same as no trades done.
    assert.isTrue(spyLogIncludes(spy, -2, "Checking if the priceFeed error exceeds the threshold"));
    assert.isTrue(spyLogIncludes(spy, -1, "less than the threshold to execute a trade"));

    // Next, assume someone trades the synthetic up to a price, thereby introducing an error in the price larger
    // than the tradeExecutionThreshold. We should expect to see the bot: 1) log this accordingly 2) execute a trade via
    // the DSProxy manager 3) the resultant price being equal to the desired targetPriceSpread.

    // For this trade, swap a large number of tokenA into the pool for token B. This should push up the price. A trade of
    // 500000e18 token B should increase the price by ~ 300 USD, resulting in a price of ~1300. This creates an error
    // between the price feeds at 1300/1000 = 30%, which is above the threshold at which a trode should occur (20%).
    const params = {
      path: encodePath([tokenB.address, tokenA.address], [fee]),
      recipient: trader,
      deadline: 15798990420,
      amountIn: toWei("500000"),
      amountOutMinimum: 0,
    };

    await uniswapRouter.exactInput(params, { from: trader });

    // Double check the market moved correctly and that the uniswap Price feed correctly reports the price.
    const currentSpotPrice = (await getCurrentPrice(poolAddress, web3)).toNumber();

    assert.isTrue(currentSpotPrice < 1302 && currentSpotPrice > 1298);
    mockTime = Number((await web3.eth.getBlock("latest")).timestamp) + 1;
    await tokenPriceFeed.update();
    assert.equal(Number(fromWei(tokenPriceFeed.getCurrentPrice())).toFixed(4), currentSpotPrice.toFixed(4));
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

    assert.equal((await getCurrentPrice(poolAddress, web3)).toNumber(), 1050);
    // Equally, the price in the uniswap feed should report a price of 1050.
    mockTime = Number((await web3.eth.getBlock("latest")).timestamp) + 1;
    await tokenPriceFeed.update();
    assert.equal(
      Number(Number(fromWei(tokenPriceFeed.getLastBlockPrice())).toFixed(4)),
      (await getCurrentPrice(poolAddress, web3)).toNumber()
    );

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
    assert.equal((await getCurrentPrice(poolAddress, web3)).toNumber(), 1000); // price should be exactly 1000 TokenA/TokenB before any trades.
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
    // This yields 1250*0.95 = 1187.5 as the expected market price.
    assert.equal((await getCurrentPrice(poolAddress, web3)).toNumber(), 1187.5);
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
