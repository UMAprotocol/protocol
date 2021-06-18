const { MAX_UINT_VAL, interfaceName, createContractObjectFromJson } = require("@uma/common");
const { toWei, toBN, utf8ToHex, fromWei } = web3.utils;

// Tested Contract
const LspUniswapV2Broker = artifacts.require("LspUniswapV2Broker");
const Token = artifacts.require("ExpandedERC20");
const WETH9 = artifacts.require("WETH9");

// Helper Contracts
const UniswapV2Factory = require("@uniswap/v2-core/build/UniswapV2Factory.json");
const IUniswapV2Pair = require("@uniswap/v2-core/build/IUniswapV2Pair.json");
const UniswapV2Router02 = require("@uniswap/v2-periphery/build/UniswapV2Router02.json");
const { assert } = require("chai");

// LSP contracts
const LongShortPair = artifacts.require("LongShortPair");
const LongShortPairFinancialProjectLibraryTest = artifacts.require("LongShortPairFinancialProjectLibraryTest");
const AddressWhitelist = artifacts.require("AddressWhitelist");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const Finder = artifacts.require("Finder");
const Timer = artifacts.require("Timer");
const OptimisticOracle = artifacts.require("OptimisticOracle");

// Uniswap contracts
let factory;
let router;
let pair;
let pairAddress;

// Tested contract
let lspUniswapV2Broker;

// LSP and UMA contract state
let collateralToken;
let longToken;
let shortToken;
let longShortPair;
let longShortPairLibrary;
let collateralWhitelist;
let identifierWhitelist;
let optimisticOracle;
let finder;
let timer;

const ancillaryData = web3.utils.utf8ToHex("some-address-field:0x1234");
const startTimestamp = Math.floor(Date.now() / 1000);
const expirationTimestamp = startTimestamp + 10000;
const optimisticOracleLiveness = 7200;
const priceFeedIdentifier = utf8ToHex("TEST_IDENTIFIER");
const collateralPerPair = toWei("1"); // each pair of long and short tokens need 1 unit of collateral to mint.
const prepaidProposerReward = toWei("0");

// Returns the current spot price of a uniswap pool, scaled to 4 decimal points.
const getPoolSpotPrice = async (tokenA, tokenB) => {
  const poolTokenABallance = await tokenA.balanceOf(pairAddress);
  const poolTokenBBallance = await tokenB.balanceOf(pairAddress);
  return Number(fromWei(poolTokenABallance.mul(toBN(toWei("1"))).div(poolTokenBBallance))).toFixed(4);
};

// For a given amountIn, return the amount out expected from a trade. aToB defines the direction of the trade. If aToB
// is true then the trader is exchanging token a for token b. Else, exchanging token b for token a.
const getAmountOut = async (tokenA, tokenB, amountIn, aToB) => {
  const [reserveIn, reserveOut] = aToB
    ? await Promise.all([tokenA.balanceOf(pairAddress), tokenB.balanceOf(pairAddress)])
    : await Promise.all([tokenB.balanceOf(pairAddress), tokenA.balanceOf(pairAddress)]);

  console.log("reserveIn", reserveIn.toString());
  console.log("reserveOut", reserveOut.toString());

  console.log(amountIn, amountIn.toString());

  const amountInWithFee = toBN(amountIn).muln(997);
  const numerator = amountInWithFee.mul(reserveOut);
  const denominator = reserveIn.muln(1000).add(amountInWithFee);
  console.log("numerator.div(denominator);", numerator.div(denominator).toString());
  return numerator.div(denominator);
};

contract("LspUniswapV2Broker", function (accounts) {
  const deployer = accounts[0];
  const trader = accounts[1];
  before(async () => {
    const WETH = await WETH9.new();
    // deploy Uniswap V2 Factory & router.
    factory = await createContractObjectFromJson(UniswapV2Factory, web3).new(deployer, { from: deployer });
    router = await createContractObjectFromJson(UniswapV2Router02, web3).new(factory.address, WETH.address, {
      from: deployer,
    });

    // create a LspUniswapV2Broker
    lspUniswapV2Broker = await LspUniswapV2Broker.new();

    finder = await Finder.deployed();
    timer = await Timer.deployed();
    collateralWhitelist = await AddressWhitelist.deployed();

    identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(priceFeedIdentifier, { from: deployer });
  });
  beforeEach(async () => {
    // Force each test to start with a simulated time that's synced to the startTimestamp.
    await timer.setCurrentTime(startTimestamp);

    // Create the LSP

    collateralToken = await Token.new("Wrapped Ether", "WETH", 18, { from: deployer });
    await collateralToken.addMember(1, deployer, { from: deployer });
    await collateralToken.mint(deployer, toWei("1000000"), { from: deployer });

    await collateralWhitelist.addToWhitelist(collateralToken.address);

    longToken = await Token.new("Long Token", "lTKN", 18, { from: deployer });
    shortToken = await Token.new("Short Token", "sTKN", 18, { from: deployer });

    optimisticOracle = await OptimisticOracle.new(optimisticOracleLiveness, finder.address, timer.address);
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.OptimisticOracle), optimisticOracle.address, {
      from: deployer,
    });

    // Create LSP library and LSP contract.
    longShortPairLibrary = await LongShortPairFinancialProjectLibraryTest.new();

    longShortPair = await LongShortPair.new(
      expirationTimestamp,
      collateralPerPair,
      priceFeedIdentifier,
      longToken.address,
      shortToken.address,
      collateralToken.address,
      finder.address,
      longShortPairLibrary.address,
      ancillaryData,
      prepaidProposerReward,
      timer.address
    );

    // Add mint and burn roles for the long and short tokens to the long short pair.
    await longToken.addMember(1, longShortPair.address, { from: deployer });
    await shortToken.addMember(1, longShortPair.address, { from: deployer });
    await longToken.addMember(2, longShortPair.address, { from: deployer });
    await shortToken.addMember(2, longShortPair.address, { from: deployer });
  });

  describe("AMM contains Long against Short token", () => {
    beforeEach(async () => {
      // Initialize the pair. For this set of tests the long and short tokens are tokenA and tokenB in the pool.
      await factory.createPair(shortToken.address, longToken.address, { from: deployer });
      pairAddress = await factory.getPair(shortToken.address, longToken.address);
      pair = await createContractObjectFromJson(IUniswapV2Pair, web3).at(pairAddress);

      // Next, mint some tokens from the LSP and add liquidity to the AMM. Add 100000 long and short tokens. From
      // this the starting price will be 1 long/short.
      await collateralToken.approve(longShortPair.address, toWei("100000"));
      await longShortPair.create(toWei("100000"));

      await longToken.approve(router.address, toWei("100000"));
      await shortToken.approve(router.address, toWei("100000"));
      await router.addLiquidity(
        longToken.address,
        shortToken.address,
        toWei("100000"),
        toWei("100000"),
        "0",
        "0",
        deployer,
        MAX_UINT_VAL,
        { from: deployer }
      );
      assert.equal((await longToken.balanceOf(pair.address)).toString(), toWei("100000"));
      assert.equal((await shortToken.balanceOf(pair.address)).toString(), toWei("100000"));
      assert.equal(await getPoolSpotPrice(longToken, shortToken), "1.0000"); // price should be exactly 1000 TokenA/TokenB.})
    });

    it("Can correctly mint and go long in one transaction", async function () {
      await collateralToken.mint(trader, toWei("1000"), { from: deployer });
      assert.equal((await collateralToken.balanceOf(trader)).toString(), toWei("1000"));

      // Calculate the expected long purchased with the short  from the trade before the trade is done (initial reserves).
      const longFromSale = await getAmountOut(shortToken, longToken, toWei("1000"), true);

      await collateralToken.approve(lspUniswapV2Broker.address, toWei("1000"), { from: trader });
      await lspUniswapV2Broker.atomicMintSellOneSide(
        true, // tradingAsEOA. true as calling from an EOA (not DSProxy).
        true, // tradingLong. we want to hold long tokens after the call.
        longShortPair.address, // longShortPair. address to mint tokens against.
        router.address, // router. uniswap v2 router to execute trades
        toWei("1000"), // collateralToMintWith. we will use 1000 units of collateral to mint 1000 long and 1000 short tokens.
        [shortToken.address, longToken.address], // swapPath. exchange the short tokens for long tokens.
        MAX_UINT_VAL, // unreachable deadline
        { from: trader }
      );

      // The trader should no collateral left (spent all 1000).
      assert.equal((await collateralToken.balanceOf(trader)).toString(), toWei("0"));

      // The trader should have no short tokens as they were all sold when minting.
      assert.equal((await shortToken.balanceOf(trader)).toString(), toWei("0"));

      // The trader should have the exact number of long tokens from minting + those from buying with the sold short side.
      assert.equal((await longToken.balanceOf(trader)).toString(), toBN(toWei("1000")).add(longFromSale).toString());

      // The broker should have 0 tokens (long,short and collateral) in it after the trade.
      assert.equal((await longToken.balanceOf(lspUniswapV2Broker.address)).toString(), toWei("0"));
      assert.equal((await shortToken.balanceOf(lspUniswapV2Broker.address)).toString(), toWei("0"));
      assert.equal((await collateralToken.balanceOf(lspUniswapV2Broker.address)).toString(), toWei("0"));
    });

    it("Can correctly mint and go short in one transaction", async function () {
      await collateralToken.mint(trader, toWei("1000"), { from: deployer });
      assert.equal((await collateralToken.balanceOf(trader)).toString(), toWei("1000"));

      // Calculate the expected short purchased with the long  from the trade before the trade is done (initial reserves).
      const shortFromSale = await getAmountOut(longToken, shortToken, toWei("1000"), true);

      await collateralToken.approve(lspUniswapV2Broker.address, toWei("1000"), { from: trader });
      await lspUniswapV2Broker.atomicMintSellOneSide(
        true, // tradingAsEOA. true as calling from an EOA (not DSProxy).
        false, // tradingLong. we want to hold short tokens after the call so set to false (short trade).
        longShortPair.address, // longShortPair. address to mint tokens against.
        router.address, // router. uniswap v2 router to execute trades
        toWei("1000"), // collateralToMintWith. we will use 1000 units of collateral to mint 1000 long and 1000 short tokens.
        [longToken.address, shortToken.address], // swapPath. exchange the long tokens for short tokens.
        MAX_UINT_VAL, // unreachable deadline
        { from: trader }
      );

      // The trader should no collateral left (spent all 1000).
      assert.equal((await collateralToken.balanceOf(trader)).toString(), toWei("0"));

      // The trader should have no long tokens as they were all sold when minting.
      assert.equal((await longToken.balanceOf(trader)).toString(), toWei("0"));

      assert.equal((await shortToken.balanceOf(trader)).toString(), toBN(toWei("1000")).add(shortFromSale).toString());

      // The broker should have 0 tokens (long,short and collateral) in it after the trade.
      assert.equal((await longToken.balanceOf(lspUniswapV2Broker.address)).toString(), toWei("0"));
      assert.equal((await shortToken.balanceOf(lspUniswapV2Broker.address)).toString(), toWei("0"));
      assert.equal((await collateralToken.balanceOf(lspUniswapV2Broker.address)).toString(), toWei("0"));
    });
  });
});
