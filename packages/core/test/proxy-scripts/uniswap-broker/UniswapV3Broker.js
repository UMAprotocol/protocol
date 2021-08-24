const hre = require("hardhat");
const { getContract } = hre;
const { runDefaultFixture } = require("@uma/common");
const { toWei, toBN } = web3.utils;
const { assert } = require("chai");

const {
  MAX_UINT_VAL,
  encodePriceSqrt,
  getTickFromPrice,
  getCurrentPrice,
  encodePath,
  getTickBitmapIndex,
  computePoolAddress,
  FeeAmount,
  TICK_SPACINGS,
  createContractObjectFromJson,
  replaceLibraryBindingReferenceInArtitifact,
} = require("@uma/common");

// Tested Contract
const UniswapV3Broker = getContract("UniswapV3Broker");

// Some helper contracts.
const Token = getContract("ExpandedERC20");
const WETH9 = getContract("WETH9");

// Import all the uniswap related contracts.
const SwapRouter = require("@uniswap/v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json");
const UniswapV3Factory = require("@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json");
const NonfungiblePositionManager = require("@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json");
const TickLens = require("@uniswap/v3-periphery/artifacts/contracts/lens/TickLens.sol/TickLens.json");

// NonfungibleTokenPositionDescriptor has a library that needs to be linked. To do this using an artifact imported from
// an external project we need to do a small find and replace within the json artifact.
const NonfungibleTokenPositionDescriptor = replaceLibraryBindingReferenceInArtitifact(
  require("@uniswap/v3-periphery/artifacts/contracts/NonfungibleTokenPositionDescriptor.sol/NonfungibleTokenPositionDescriptor.json"),
  "NFTDescriptor"
);

const NFTDescriptor = require("@uniswap/v3-periphery/artifacts/contracts/libraries/NFTDescriptor.sol/NFTDescriptor.json");

let weth;
let factory;
let router;
let positionDescriptor;
let positionManager;
let tickLens;
let uniswapV3Broker;
let fee = FeeAmount.MEDIUM;
let poolAddress;
let tokenA;
let tokenB;

describe("UniswapV3Broker", function () {
  let accounts;
  let deployer;
  let trader;

  async function addLiquidityToPool(amount0Desired, amount1Desired, tickLower, tickUpper) {
    if (tokenA.options.address.toLowerCase() > tokenB.options.address.toLowerCase())
      [tokenA, tokenB] = [tokenB, tokenA];

    await positionManager.methods
      .createAndInitializePoolIfNecessary(
        tokenA.options.address,
        tokenB.options.address,
        fee,
        encodePriceSqrt(amount0Desired, amount1Desired) // start the pool price at 10 tokenA/tokenB
      )
      .send({ from: trader });

    const liquidityParams = {
      token0: tokenA.options.address,
      token1: tokenB.options.address,
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

    await positionManager.methods.mint(liquidityParams).send({ from: trader });
    poolAddress = computePoolAddress(factory.options.address, tokenA.options.address, tokenB.options.address, fee);
  }

  before(async () => {
    accounts = await web3.eth.getAccounts();
    [deployer, trader] = accounts;
    await runDefaultFixture(hre);
    // deploy an instance of the broker
    uniswapV3Broker = await UniswapV3Broker.new().send({ from: accounts[0] });

    weth = await WETH9.new().send({ from: accounts[0] });
    // deploy Uniswap V3 Factory, router, position manager, position descriptor and tickLens.
    factory = (await createContractObjectFromJson(UniswapV3Factory, web3).new({ from: deployer })).contract;
    router = (
      await createContractObjectFromJson(SwapRouter, web3).new(factory.options.address, weth.options.address, {
        from: deployer,
      })
    ).contract;

    const PositionDescriptor = createContractObjectFromJson(NonfungibleTokenPositionDescriptor, web3);
    await PositionDescriptor.detectNetwork();

    PositionDescriptor.link(await createContractObjectFromJson(NFTDescriptor, web3).new({ from: deployer }));
    positionDescriptor = (await PositionDescriptor.new(weth.options.address, { from: deployer })).contract;

    positionManager = (
      await createContractObjectFromJson(NonfungiblePositionManager, web3).new(
        factory.options.address,
        weth.options.address,
        positionDescriptor.options.address,
        { from: deployer }
      )
    ).contract;

    tickLens = (await createContractObjectFromJson(TickLens, web3).new({ from: deployer })).contract;
  });

  beforeEach(async () => {
    // deploy tokens
    tokenA = await Token.new("Token0", "T0", 18).send({ from: accounts[0] });
    tokenB = await Token.new("Token1", "T1", 18).send({ from: accounts[0] });

    await tokenA.methods.addMember(1, deployer).send({ from: deployer });
    await tokenB.methods.addMember(1, deployer).send({ from: deployer });

    await tokenA.methods.mint(trader, toWei("100000000000000")).send({ from: accounts[0] });
    await tokenB.methods.mint(trader, toWei("100000000000000")).send({ from: accounts[0] });

    for (const address of [positionManager.options.address, router.options.address, uniswapV3Broker.options.address]) {
      await tokenA.methods.approve(address, toWei("100000000000000")).send({ from: trader });
      await tokenB.methods.approve(address, toWei("100000000000000")).send({ from: trader });
    }
  });

  describe("Simple Uniswap interactions", () => {
    it("Validate Uniswap behaviour with a simple swap", async function () {
      // First, add liquidity to the pool. Initialize the pool with a price of 10 TokenA/TokenB by adding 1000 tokenA
      // and 100 token B. Set the liquidity range between a price of 8 and 15.
      await addLiquidityToPool(toWei("1000"), toWei("100"), getTickFromPrice(8, fee), getTickFromPrice(15, fee));

      // The starting price should be 10.
      assert.equal((await getCurrentPrice(poolAddress, web3)).toNumber(), 10);

      // Validate the liquidity is within the range. There is one LP within the pool and their range is between 8 and 15.
      const liquidityInRange = await tickLens.methods
        .getPopulatedTicksInWord(poolAddress, getTickBitmapIndex(getTickFromPrice(10, fee), TICK_SPACINGS[fee]))
        .call();
      assert.equal(liquidityInRange[0].tick, getTickFromPrice(15, fee)); // the ticks should match that of the price range.
      assert.equal(liquidityInRange[1].tick, getTickFromPrice(8, fee));

      // Next, execute a swap and ensure that token balances change as expected. we will trade tokenA for tokenB to increase
      // the price of the tokens. define the trade params according to the uniswap spec.
      const tokens = [tokenA.options.address, tokenB.options.address];
      const params = {
        path: encodePath(tokens, new Array(tokens.length - 1).fill(fee)),
        recipient: trader,
        deadline: 15798990420,
        amountIn: toWei("1"), // swap exactly 1 wei of token 1
        amountOutMinimum: 0,
      };

      // Store the token balances before the trade
      const tokenABefore = toBN(await tokenA.methods.balanceOf(trader).call());
      const tokenBBefore = toBN(await tokenB.methods.balanceOf(trader).call());

      await router.methods.exactInput(params).send({ from: trader });

      const deltaTokenA = tokenABefore.sub(toBN(await tokenA.methods.balanceOf(trader).call()));
      const deltaTokenB = tokenBBefore.sub(toBN(await tokenB.methods.balanceOf(trader).call()));

      // Token A should have increased by exactly 1 wei. This is the exact amount traded in the exactInput
      assert.equal(deltaTokenA, toWei("1"));

      // Token B should have decreased by the amount spent. This should be negative (tokens left the wallet) and should
      // be about 0.01 due to the starting price in the pool. bound between 0 and -0.01.
      assert.isTrue(deltaTokenB.gt(web3.utils.toWei("-0.01")) && deltaTokenB.lt(web3.utils.toWei("0")));
    });
  });

  describe("Single liquidity provider", () => {
    beforeEach(async () => {
      // With just one liquidity provider, uniswapV3 acts like a standard AMM.
      await addLiquidityToPool(toWei("1000"), toWei("100"), getTickFromPrice(8, fee), getTickFromPrice(15, fee));
      // The starting price should be 10.
      assert.equal((await getCurrentPrice(poolAddress, web3)).toNumber(), 10);
    });
    it("Broker can correctly move the price up with a single liquidity provider", async function () {
      // The broker should be able to trade up to a desired price. The starting price is 10. Try trade the market to 13.

      await uniswapV3Broker.methods
        .swapToPrice(
          true, // Set Trading as EOA to true. This will pull tokens from the EOA and sent the output back to the EOA.
          poolAddress, // Pool address for compting trade size.
          router.options.address, // Router for executing the trade.
          encodePriceSqrt(13, 1), // encoded target price of 13 defined as an X96 square root.
          trader, // recipient of the trade.
          MAX_UINT_VAL // max deadline.
        )
        .send({ from: trader });

      // check the price moved up to 13 correctly.
      const postTradePrice = (await getCurrentPrice(poolAddress, web3)).toNumber();
      assert.equal(postTradePrice, 13);
    });

    it("Broker can correctly move the price down with a single liquidity provider", async function () {
      // The broker should be able to trade down to a desired price. The starting price at 10. Try trade the market to 8.5.

      await uniswapV3Broker.methods
        .swapToPrice(
          true, // Set Trading as EOA to true. This will pull tokens from the EOA and sent the output back to the EOA.
          poolAddress, // Pool address for compting trade size.
          router.options.address, // Router for executing the trade.
          encodePriceSqrt(8.5, 1), // encoded target price defined as an X96 square root.
          trader, // recipient of the trade.
          MAX_UINT_VAL // max deadline.
        )
        .send({ from: trader });

      // check the price moved up to 12 correctly.
      const postTradePrice = (await getCurrentPrice(poolAddress, web3)).toNumber();
      assert.equal(postTradePrice, 8.5);
    });
  });
  describe("Multi-complex liquidity provider", () => {
    beforeEach(async () => {
      // Add a number of liquidity providers, all at the same price, over a range of price ticks. When trying to move
      // the market within unit tests that follows we will traverse a number of ticks. Some that start within the range
      // and others that are only entered after the market has moved a bit. This represents a real world setup.
      await addLiquidityToPool(toWei("1000"), toWei("100"), getTickFromPrice(8, fee), getTickFromPrice(15, fee));
      await addLiquidityToPool(toWei("100"), toWei("10"), getTickFromPrice(9.9, fee), getTickFromPrice(10.1, fee));
      await addLiquidityToPool(toWei("50"), toWei("5"), getTickFromPrice(5, fee), getTickFromPrice(20, fee));
      await addLiquidityToPool(toWei("10"), toWei("1"), getTickFromPrice(12, fee), getTickFromPrice(15, fee));
      await addLiquidityToPool(toWei("10"), toWei("1"), getTickFromPrice(6, fee), getTickFromPrice(8, fee));
      await addLiquidityToPool(toWei("65"), toWei("6.5"), getTickFromPrice(10, fee), getTickFromPrice(11, fee));
      await addLiquidityToPool(toWei("65"), toWei("6.5"), getTickFromPrice(8.5, fee), getTickFromPrice(9, fee));
      // The starting price should be 10 as all LPs added at the same price.
      assert.equal((await getCurrentPrice(poolAddress, web3)).toNumber(), 10);
    });
    it("Broker can correctly move the price up with a set of liquidity provider", async function () {
      // The broker should be able to trade up to a desired price. The starting price is 10. Try trade the market to 13.

      await uniswapV3Broker.methods
        .swapToPrice(
          true, // Set Trading as EOA to true. This will pull tokens from the EOA and sent the output back to the EOA.
          poolAddress, // Pool address for compting trade size.
          router.options.address, // Router for executing the trade.
          encodePriceSqrt(13, 1), // encoded target price of 13 defined as an X96 square root.
          trader, // recipient of the trade.
          MAX_UINT_VAL // max deadline.
        )
        .send({ from: trader });

      // check the price moved up to 12 correctly.
      const postTradePrice = (await getCurrentPrice(poolAddress, web3)).toNumber();
      assert.equal(postTradePrice, 13);
    });

    it("Broker can correctly move the price down with a set of liquidity provider", async function () {
      // The broker should be able to trade down to a desired price. The starting price at 10. Try trade the market to 8.5.

      await uniswapV3Broker.methods
        .swapToPrice(
          true, // Set Trading as EOA to true. This will pull tokens from the EOA and sent the output back to the EOA.
          poolAddress, // Pool address for compting trade size.
          router.options.address, // Router for executing the trade.
          encodePriceSqrt(8.5, 1), // encoded target price defined as an X96 square root.
          trader, // recipient of the trade.
          MAX_UINT_VAL // max deadline.
        )
        .send({ from: trader });

      // check the price moved up to 8.5 correctly.
      const postTradePrice = (await getCurrentPrice(poolAddress, web3)).toNumber();
      assert.equal(postTradePrice, 8.5);
    });
  });
});
