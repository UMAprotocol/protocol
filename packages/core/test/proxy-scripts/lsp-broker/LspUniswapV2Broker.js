const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract } = hre;
const {
  MAX_UINT_VAL,
  interfaceName,
  createContractObjectFromJson,
  didContractThrow,
  ZERO_ADDRESS,
} = require("@uma/common");
const { toWei, toBN, utf8ToHex, fromWei, padRight } = web3.utils;

// Tested Contract
const LspUniswapV2Broker = getContract("LspUniswapV2Broker");
const Token = getContract("ExpandedERC20");
const WETH9 = getContract("WETH9");

// Helper Contracts
const UniswapV2Factory = require("@uniswap/v2-core/build/UniswapV2Factory.json");
const IUniswapV2Pair = require("@uniswap/v2-core/build/IUniswapV2Pair.json");
const UniswapV2Router02 = require("@uniswap/v2-periphery/build/UniswapV2Router02.json");
const DSProxyFactory = getContract("DSProxyFactory");
const DSProxy = getContract("DSProxy");
const { assert } = require("chai");

// LSP contracts
const LongShortPair = getContract("LongShortPair");
const LongShortPairFinancialProjectLibraryTest = getContract("LongShortPairFinancialProjectLibraryTest");
const AddressWhitelist = getContract("AddressWhitelist");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const Finder = getContract("Finder");
const Timer = getContract("Timer");
const OptimisticOracle = getContract("OptimisticOracle");

// Uniswap contracts
let factory;
let router;
let pair;
let pairAddress;
let lpToken;

// DS Proxy contracts
let dsProxy;
let dsProxyFactory;

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
const priceIdentifier = padRight(utf8ToHex("TEST_IDENTIFIER"), 64);
const collateralPerPair = toWei("1"); // each pair of long and short tokens need 1 unit of collateral to mint.
const proposerReward = toWei("0");
const pairName = "Long Short Pair Test";

// Returns the current spot price of a uniswap pool, scaled to `precision` # decimal points.
const getPoolSpotPrice = async (tokenA, tokenB, _pairAddress = pairAddress, precision = 4) => {
  const poolTokenABalance = toBN(await tokenA.methods.balanceOf(_pairAddress).call());
  const poolTokenBBalance = toBN(await tokenB.methods.balanceOf(_pairAddress).call());
  return Number(fromWei(poolTokenABalance.mul(toBN(toWei("1"))).div(poolTokenBBalance))).toFixed(precision);
};

// For a given amountIn, return the amount out expected from a trade. aToB defines the direction of the trade. If aToB
// is true then the trader is exchanging token a for token b. Else, exchanging token b for token a.
const getAmountOut = async (tokenA, tokenB, amountIn, aToB, _pairAddress = pairAddress) => {
  const [reserveIn, reserveOut] = aToB
    ? await Promise.all([tokenA.methods.balanceOf(_pairAddress).call(), tokenB.methods.balanceOf(_pairAddress).call()])
    : await Promise.all([tokenB.methods.balanceOf(_pairAddress).call(), tokenA.methods.balanceOf(_pairAddress).call()]);
  const amountInWithFee = toBN(amountIn).muln(997);
  const numerator = amountInWithFee.mul(toBN(reserveOut));
  const denominator = toBN(reserveIn).muln(1000).add(amountInWithFee);
  return numerator.div(denominator);
};

describe("LspUniswapV2Broker", function () {
  let accounts;
  let deployer;
  let trader;

  const addLiquidityToPool = async (tokenA, tokenB, longAmount, shortAmount, _pair = pair) => {
    await router.methods
      .addLiquidity(
        tokenA.options.address,
        tokenB.options.address,
        longAmount,
        shortAmount,
        "0",
        "0",
        deployer,
        MAX_UINT_VAL
      )
      .send({ from: deployer });
    lpToken = await Token.at(_pair.options.address);

    assert.equal((await tokenA.methods.balanceOf(_pair.options.address).call()).toString(), longAmount);
    assert.equal((await tokenB.methods.balanceOf(_pair.options.address).call()).toString(), shortAmount);
  };

  before(async () => {
    accounts = await web3.eth.getAccounts();
    [deployer, trader] = accounts;
    await runDefaultFixture(hre);
    dsProxyFactory = await DSProxyFactory.new().send({ from: accounts[0] });

    const WETH = await WETH9.new().send({ from: accounts[0] });
    // deploy Uniswap V2 Factory & router.
    factory = (await createContractObjectFromJson(UniswapV2Factory, web3).new(deployer, { from: deployer })).contract;
    router = (
      await createContractObjectFromJson(UniswapV2Router02, web3).new(factory.options.address, WETH.options.address, {
        from: deployer,
      })
    ).contract;

    // create a LspUniswapV2Broker
    lspUniswapV2Broker = await LspUniswapV2Broker.new().send({ from: accounts[0] });

    finder = await Finder.deployed();
    timer = await Timer.deployed();
    collateralWhitelist = await AddressWhitelist.deployed();

    identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.methods.addSupportedIdentifier(priceIdentifier).send({ from: deployer });
  });

  beforeEach(async () => {
    // Force each test to start with a simulated time that's synced to the startTimestamp.
    await timer.methods.setCurrentTime(startTimestamp).send({ from: accounts[0] });

    // Create the LSP

    collateralToken = await Token.new("Wrapped Ether", "WETH", 18).send({ from: deployer });
    await collateralToken.methods.addMember(1, deployer).send({ from: deployer });
    await collateralToken.methods.mint(deployer, toWei("10000000")).send({ from: deployer });

    await collateralWhitelist.methods.addToWhitelist(collateralToken.options.address).send({ from: accounts[0] });

    longToken = await Token.new("Long Token", "lTKN", 18).send({ from: deployer });
    shortToken = await Token.new("Short Token", "sTKN", 18).send({ from: deployer });

    optimisticOracle = await OptimisticOracle.new(
      optimisticOracleLiveness,
      finder.options.address,
      timer.options.address
    ).send({ from: accounts[0] });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.OptimisticOracle), optimisticOracle.options.address)
      .send({ from: deployer });

    // Create LSP library and LSP contract.
    longShortPairLibrary = await LongShortPairFinancialProjectLibraryTest.new().send({ from: accounts[0] });

    longShortPair = await LongShortPair.new({
      pairName,
      expirationTimestamp,
      collateralPerPair,
      priceIdentifier,
      longToken: longToken.options.address,
      shortToken: shortToken.options.address,
      collateralToken: collateralToken.options.address,
      financialProductLibrary: longShortPairLibrary.options.address,
      customAncillaryData: ancillaryData,
      proposerReward,
      optimisticOracleLivenessTime: 7200,
      optimisticOracleProposerBond: toWei("0"),
      finder: finder.options.address,
      timerAddress: timer.options.address,
    }).send({ from: accounts[0] });

    // Add mint and burn roles for the long and short tokens to the long short pair.
    await longToken.methods.addMember(1, longShortPair.options.address).send({ from: deployer });
    await shortToken.methods.addMember(1, longShortPair.options.address).send({ from: deployer });
    await longToken.methods.addMember(2, longShortPair.options.address).send({ from: deployer });
    await shortToken.methods.addMember(2, longShortPair.options.address).send({ from: deployer });

    // Initialize the UniV2 pool. For this set of tests the long and short tokens are tokenA and tokenB in the pool.
    await factory.methods.createPair(shortToken.options.address, longToken.options.address).send({ from: deployer });
    pairAddress = await factory.methods.getPair(shortToken.options.address, longToken.options.address).call();
    pair = (await createContractObjectFromJson(IUniswapV2Pair, web3).at(pairAddress)).contract;
    lpToken = await Token.at(pair.options.address);

    // Next, mint some tokens from the LSP and add liquidity to the AMM. Add 1000000 long and short tokens. From
    // this the starting price will be 1 long/short.
    await collateralToken.methods.approve(longShortPair.options.address, toWei("1000000")).send({ from: accounts[0] });
    await longShortPair.methods.create(toWei("1000000")).send({ from: accounts[0] });

    await longToken.methods.approve(router.options.address, toWei("1000000")).send({ from: accounts[0] });
    await shortToken.methods.approve(router.options.address, toWei("1000000")).send({ from: accounts[0] });

    // Mint EOA some collateral to the trader
    await collateralToken.methods.mint(trader, toWei("1000")).send({ from: deployer });
    await collateralToken.methods.approve(lspUniswapV2Broker.options.address, toWei("1000")).send({ from: trader });
  });

  describe("atomicMintSellOneSide: AMM contains Long against Short token", () => {
    beforeEach(async () => {
      await addLiquidityToPool(longToken, shortToken, toWei("100000"), toWei("100000"));
    });

    it("Can correctly mint and go long in one transaction", async function () {
      // Calculate the expected long purchased with the short  from the trade before the trade is done (initial reserves).
      const longFromSale = await getAmountOut(shortToken, longToken, toWei("1000"), true);

      await lspUniswapV2Broker.methods
        .atomicMintSellOneSide(
          true, // tradingAsEOA. true as calling from an EOA (not DSProxy).
          true, // tradingLong. we want to hold long tokens after the call.
          longShortPair.options.address, // longShortPair. address to mint tokens against.
          router.options.address, // router. uniswap v2 router to execute trades
          toWei("1000"), // collateralToMintWith. we will use 1000 units of collateral to mint 1000 long and 1000 short tokens.
          [shortToken.options.address, longToken.options.address], // swapPath. exchange the short tokens for long tokens.
          MAX_UINT_VAL // unreachable deadline
        )
        .send({ from: trader });

      // The trader should no collateral left (spent all 1000).
      assert.equal((await collateralToken.methods.balanceOf(trader).call()).toString(), toWei("0"));

      // The trader should have no short tokens as they were all sold when minting.
      assert.equal((await shortToken.methods.balanceOf(trader).call()).toString(), toWei("0"));

      // The trader should have the exact number of long tokens from minting + those from buying with the sold short side.
      assert.equal(
        (await longToken.methods.balanceOf(trader).call()).toString(),
        toBN(toWei("1000")).add(longFromSale).toString()
      );

      // The broker should have 0 tokens (long,short and collateral) in it after the trade.
      assert.equal(
        (await longToken.methods.balanceOf(lspUniswapV2Broker.options.address).call()).toString(),
        toWei("0")
      );
      assert.equal(
        (await shortToken.methods.balanceOf(lspUniswapV2Broker.options.address).call()).toString(),
        toWei("0")
      );
      assert.equal(
        (await collateralToken.methods.balanceOf(lspUniswapV2Broker.options.address).call()).toString(),
        toWei("0")
      );
    });

    it("Can correctly mint and go short in one transaction", async function () {
      // Calculate the expected short purchased with the long  from the trade before the trade is done (initial reserves).
      const shortFromSale = await getAmountOut(longToken, shortToken, toWei("1000"), true);

      await lspUniswapV2Broker.methods
        .atomicMintSellOneSide(
          true, // tradingAsEOA. true as calling from an EOA (not DSProxy).
          false, // tradingLong. we want to hold short tokens after the call so set to false (short trade).
          longShortPair.options.address, // longShortPair. address to mint tokens against.
          router.options.address, // router. uniswap v2 router to execute trades
          toWei("1000"), // collateralToMintWith. we will use 1000 units of collateral to mint 1000 long and 1000 short tokens.
          [longToken.options.address, shortToken.options.address], // swapPath. exchange the long tokens for short tokens.
          MAX_UINT_VAL // unreachable deadline
        )
        .send({ from: trader });

      // The trader should no collateral left (spent all 1000).
      assert.equal((await collateralToken.methods.balanceOf(trader).call()).toString(), toWei("0"));

      // The trader should have no long tokens as they were all sold when minting.
      assert.equal((await longToken.methods.balanceOf(trader).call()).toString(), toWei("0"));

      assert.equal(
        (await shortToken.methods.balanceOf(trader).call()).toString(),
        toBN(toWei("1000")).add(shortFromSale).toString()
      );

      // The broker should have 0 tokens (long,short and collateral) in it after the trade.
      assert.equal(
        (await longToken.methods.balanceOf(lspUniswapV2Broker.options.address).call()).toString(),
        toWei("0")
      );
      assert.equal(
        (await shortToken.methods.balanceOf(lspUniswapV2Broker.options.address).call()).toString(),
        toWei("0")
      );
      assert.equal(
        (await collateralToken.methods.balanceOf(lspUniswapV2Broker.options.address).call()).toString(),
        toWei("0")
      );
    });

    it("Invalid params", async function () {
      // Invalid LSP contract
      assert(
        await didContractThrow(
          lspUniswapV2Broker.methods
            .atomicMintSellOneSide(
              true,
              false,
              ZERO_ADDRESS, // Zero address
              router.options.address,
              toWei("1000"),
              [longToken.options.address, shortToken.options.address],
              MAX_UINT_VAL
            )
            .send({ from: trader })
        )
      );
      assert(
        await didContractThrow(
          lspUniswapV2Broker.methods
            .atomicMintSellOneSide(
              true,
              false,
              router.options.address, // Not an LSP contract
              router.options.address,
              toWei("1000"),
              [longToken.options.address, shortToken.options.address],
              MAX_UINT_VAL
            )
            .send({ from: trader })
        )
      );

      // Invalid router contract
      assert(
        await didContractThrow(
          lspUniswapV2Broker.methods
            .atomicMintSellOneSide(
              true,
              false,
              longShortPair.options.address,
              ZERO_ADDRESS, // Zero address
              toWei("1000"),
              [longToken.options.address, shortToken.options.address],
              MAX_UINT_VAL
            )
            .send({ from: trader })
        )
      );
      assert(
        await didContractThrow(
          lspUniswapV2Broker.methods
            .atomicMintSellOneSide(
              true,
              false,
              longShortPair.options.address,
              longShortPair.options.address, // Not a router contract
              toWei("1000"),
              [longToken.options.address, shortToken.options.address],
              MAX_UINT_VAL
            )
            .send({ from: trader })
        )
      );

      // Cannot mint with 0 collateral
      assert(
        await didContractThrow(
          lspUniswapV2Broker.methods
            .atomicMintSellOneSide(
              true,
              false,
              longShortPair.options.address,
              router.options.address,
              "0",
              [longToken.options.address, shortToken.options.address],
              MAX_UINT_VAL
            )
            .send({ from: trader })
        )
      );

      // Swap path doesn't have sold token as first token.
      assert(
        await didContractThrow(
          lspUniswapV2Broker.methods
            .atomicMintSellOneSide(
              true, // Selling long token, but long token is not first token in swapPath param.
              false,
              longShortPair.options.address,
              router.options.address,
              toWei("1000"),
              [shortToken.options.address, longShortPair.options.address],
              MAX_UINT_VAL
            )
            .send({ from: trader })
        )
      );
    });

    it("Caller is a DSProxy", async function () {
      // Finally, create a DSProxy for the caller. This will be used to send mint the LSP position from.
      await dsProxyFactory.methods.build().send({ from: trader });
      dsProxy = await DSProxy.at((await dsProxyFactory.getPastEvents("Created"))[0].returnValues.proxy);

      // Send collateral to DSProxy it can use to deposit into LSP:
      await collateralToken.methods.transfer(dsProxy.options.address, toWei("1000")).send({ from: trader });
      assert.equal((await collateralToken.methods.balanceOf(dsProxy.options.address).call()).toString(), toWei("1000"));

      // Calculate the expected long purchased with the short  from the trade before the trade is done (initial reserves).
      const longFromSale = await getAmountOut(shortToken, longToken, toWei("1000"), true);

      // Execute mint+sell via DSProxy:
      const callData = lspUniswapV2Broker.methods
        .atomicMintSellOneSide(
          false, // tradingAsEOA. False and pretending to call from a contract like a DSProxy.
          true, // tradingLong. we want the contract to hold long tokens after the call.
          longShortPair.options.address, // longShortPair. address to mint tokens against.
          router.options.address, // router. uniswap v2 router to execute trades
          toWei("1000"), // collateralToMintWith. we will use 1000 units of collateral to mint 1000 long and 1000 short tokens.
          [shortToken.options.address, longToken.options.address], // swapPath. exchange the short tokens for long tokens.
          MAX_UINT_VAL // unreachable deadline
        )
        .encodeABI();
      await dsProxy.methods["execute(address,bytes)"](lspUniswapV2Broker.options.address, callData).send({
        from: trader,
      });

      // The DSProxy should no collateral left (spent all 1000).
      assert.equal((await collateralToken.methods.balanceOf(dsProxy.options.address).call()).toString(), toWei("0"));

      // The DSProxy should have no short tokens as they were all sold when minting.
      assert.equal((await shortToken.methods.balanceOf(dsProxy.options.address).call()).toString(), toWei("0"));

      // The DSProxy should have the exact number of long tokens from minting + those from buying with the sold short side.
      assert.equal(
        (await longToken.methods.balanceOf(dsProxy.options.address).call()).toString(),
        toBN(toWei("1000")).add(longFromSale).toString()
      );
    });
  });
  describe("atomicMintSellOneSide: AMM contains Long/Short against Collateral tokens", () => {
    let pair1Address, pair2Address;
    let pair1, pair2;
    beforeEach(async () => {
      // Initialize the UniV2 pools. For this set of tests the long and short tokens are both tokenA and the collateral
      // is tokenB in the pool.
      await factory.methods
        .createPair(longToken.options.address, collateralToken.options.address)
        .send({ from: deployer });
      await factory.methods
        .createPair(shortToken.options.address, collateralToken.options.address)
        .send({ from: deployer });
      pair1Address = await factory.methods.getPair(longToken.options.address, collateralToken.options.address).call();
      pair2Address = await factory.methods.getPair(shortToken.options.address, collateralToken.options.address).call();
      pair1 = (await createContractObjectFromJson(IUniswapV2Pair, web3).at(pair1Address)).contract;
      pair2 = (await createContractObjectFromJson(IUniswapV2Pair, web3).at(pair2Address)).contract;

      await collateralToken.methods.approve(router.options.address, toWei("200000")).send({ from: accounts[0] });
      await addLiquidityToPool(longToken, collateralToken, toWei("100000"), toWei("100000"), pair1);
      await addLiquidityToPool(shortToken, collateralToken, toWei("100000"), toWei("100000"), pair2);

      assert.equal(await getPoolSpotPrice(longToken, collateralToken, pair1Address), "1.0000");
      assert.equal(await getPoolSpotPrice(shortToken, collateralToken, pair2Address), "1.0000");
    });

    it("Can correctly mint and go long in one transaction", async function () {
      // Calculate the expected long purchased with the short from the 2-hop trade. We expect this to be return the user
      // fewer long tokens than they would get if there were a 1-hop trade available from a short-long pool.
      const collateralFromSale = await getAmountOut(shortToken, collateralToken, toWei("1000"), true, pair2Address);
      const longFromSale = await getAmountOut(collateralToken, longToken, collateralFromSale, true, pair1Address);

      await lspUniswapV2Broker.methods
        .atomicMintSellOneSide(
          true, // tradingAsEOA. true as calling from an EOA (not DSProxy).
          true, // tradingLong. we want to hold long tokens after the call.
          longShortPair.options.address, // longShortPair. address to mint tokens against.
          router.options.address, // router. uniswap v2 router to execute trades
          toWei("1000"), // collateralToMintWith. we will use 1000 units of collateral to mint 1000 long and 1000 short tokens.
          [shortToken.options.address, collateralToken.options.address, longToken.options.address], // swapPath.
          MAX_UINT_VAL // unreachable deadline
        )
        .send({ from: trader });

      // The trader should no collateral left (spent all 1000).
      assert.equal((await collateralToken.methods.balanceOf(trader).call()).toString(), toWei("0"));

      // The trader should have no short tokens as they were all sold when minting.
      assert.equal((await shortToken.methods.balanceOf(trader).call()).toString(), toWei("0"));

      // The trader should have the exact number of long tokens from minting + those from buying with the sold short side.
      assert.equal(
        (await longToken.methods.balanceOf(trader).call()).toString(),
        toBN(toWei("1000")).add(longFromSale).toString()
      );

      // The broker should have 0 tokens (long,short and collateral) in it after the trade.
      assert.equal(
        (await longToken.methods.balanceOf(lspUniswapV2Broker.options.address).call()).toString(),
        toWei("0")
      );
      assert.equal(
        (await shortToken.methods.balanceOf(lspUniswapV2Broker.options.address).call()).toString(),
        toWei("0")
      );
      assert.equal(
        (await collateralToken.methods.balanceOf(lspUniswapV2Broker.options.address).call()).toString(),
        toWei("0")
      );
    });
    it("Can correctly mint and go short in one transaction", async function () {
      // Calculate the expected short purchased with the long from the 2-hop trade. We expect this to be return the user
      // fewer short tokens than they would get if there were a 1-hop trade available from a short-long pool.
      const collateralFromSale = await getAmountOut(longToken, collateralToken, toWei("1000"), true, pair1Address);
      const shortFromSale = await getAmountOut(collateralToken, shortToken, collateralFromSale, true, pair2Address);

      await lspUniswapV2Broker.methods
        .atomicMintSellOneSide(
          true, // tradingAsEOA. true as calling from an EOA (not DSProxy).
          false, // tradingLong. we want to hold short tokens after the call so set to false (short trade).
          longShortPair.options.address, // longShortPair. address to mint tokens against.
          router.options.address, // router. uniswap v2 router to execute trades
          toWei("1000"), // collateralToMintWith. we will use 1000 units of collateral to mint 1000 long and 1000 short tokens.
          [longToken.options.address, collateralToken.options.address, shortToken.options.address], // swapPath.
          MAX_UINT_VAL // unreachable deadline
        )
        .send({ from: trader });

      // The trader should no collateral left (spent all 1000).
      assert.equal((await collateralToken.methods.balanceOf(trader).call()).toString(), toWei("0"));

      // The trader should have no long tokens as they were all sold when minting.
      assert.equal((await longToken.methods.balanceOf(trader).call()).toString(), toWei("0"));

      assert.equal(
        (await shortToken.methods.balanceOf(trader).call()).toString(),
        toBN(toWei("1000")).add(shortFromSale).toString()
      );

      // The broker should have 0 tokens (long,short and collateral) in it after the trade.
      assert.equal(
        (await longToken.methods.balanceOf(lspUniswapV2Broker.options.address).call()).toString(),
        toWei("0")
      );
      assert.equal(
        (await shortToken.methods.balanceOf(lspUniswapV2Broker.options.address).call()).toString(),
        toWei("0")
      );
      assert.equal(
        (await collateralToken.methods.balanceOf(lspUniswapV2Broker.options.address).call()).toString(),
        toWei("0")
      );
    });
  });
  describe("atomicMintAddLiquidity: AMM contains Long against Short token", () => {
    it("Correctly rejects mints lower than minLPTokens", async function () {
      await addLiquidityToPool(longToken, shortToken, toWei("1000000"), toWei("1000000"));

      // Set the minLPTokens to MAX_UINT_VAL. This should revert as the contract will never send this many LP tokens.
      assert(
        await didContractThrow(
          lspUniswapV2Broker.methods
            .atomicMintAddLiquidity(
              true, // tradingAsEOA. true as calling from an EOA (not DSProxy).
              longShortPair.options.address, // longShortPair. address to mint tokens against.
              router.options.address, // router. uniswap v2 router to execute trades
              toWei("1000"), // collateralToMintWith. we will use 1000 units of collateral to mint 1000 long and 1000 short tokens.
              MAX_UINT_VAL, // minLpTokens. Sets minimum number of LP tokens to get sent back. Set to 0 to ensure no revert on this param.
              MAX_UINT_VAL // deadline. Set far in the future to not hit this.
            )
            .send({ from: trader })
        )
      );
    });
    it("Invalid params", async function () {
      await addLiquidityToPool(longToken, shortToken, toWei("1000000"), toWei("1000000"));

      // Invalid LSP contract
      assert(
        await didContractThrow(
          lspUniswapV2Broker.methods
            .atomicMintAddLiquidity(
              true,
              ZERO_ADDRESS, // Zero address
              router.options.address,
              toWei("1000"),
              "0",
              MAX_UINT_VAL
            )
            .send({ from: trader })
        )
      );
      assert(
        await didContractThrow(
          lspUniswapV2Broker.methods
            .atomicMintAddLiquidity(
              true,
              router.options.address, // Not an LSP contract
              router.options.address,
              toWei("1000"),
              "0",
              MAX_UINT_VAL
            )
            .send({ from: trader })
        )
      );

      // Invalid router contract
      assert(
        await didContractThrow(
          lspUniswapV2Broker.methods
            .atomicMintAddLiquidity(
              true,
              longShortPair.options.address,
              ZERO_ADDRESS, // Zero address
              toWei("1000"),
              "0",
              MAX_UINT_VAL
            )
            .send({ from: trader })
        )
      );
      assert(
        await didContractThrow(
          lspUniswapV2Broker.methods
            .atomicMintAddLiquidity(
              true,
              longShortPair.options.address,
              longShortPair.options.address, // Not a router contract
              toWei("1000"),
              "0",
              MAX_UINT_VAL
            )
            .send({ from: trader })
        )
      );

      // Cannot mint with 0 collateral
      assert(
        await didContractThrow(
          lspUniswapV2Broker.methods
            .atomicMintAddLiquidity(true, longShortPair.options.address, router.options.address, "0", "0", MAX_UINT_VAL)
            .send({ from: trader })
        )
      );
    });
    it("Can correctly mint and LP in one transaction with pool in equal ratios", async function () {
      // Mint in exact ratios equal between long and short. There should not be any need for trading as the mint ratio
      // is exactly equal to the pool ratio.
      await addLiquidityToPool(longToken, shortToken, toWei("100000"), toWei("100000"));
      // Calculate how many LP tokens are expected to be minted per unit collateral. Trader added 100000 units of
      // to mint 100000 long and short tokens.
      const lpTokensPerCollateral = toBN(await lpToken.methods.balanceOf(deployer).call())
        .mul(toBN(toWei("1"))) // scalding factor
        .div(toBN(toWei("100000"))) // number of collateral units used in minting
        .addn(1); // offset to fix rounding error

      await lspUniswapV2Broker.methods
        .atomicMintAddLiquidity(
          true, // tradingAsEOA. true as calling from an EOA (not DSProxy).
          longShortPair.options.address, // longShortPair. address to mint tokens against.
          router.options.address, // router. uniswap v2 router to execute trades
          toWei("1000"), // collateralToMintWith. we will use 1000 units of collateral to mint 1000 long and 1000 short tokens.
          "0", // minLpTokens. Sets minimum number of LP tokens to get sent back. Set to 0 to ensure no revert on this param.
          MAX_UINT_VAL // deadline. Set far in the future to not hit this.
        )
        .send({ from: trader });

      // The trader should no collateral left (spent all 1000).
      assert.equal(toBN(await collateralToken.methods.balanceOf(trader).call()).toString(), toWei("0"));

      // The trader should have no short tokens as they were all sold when minting.
      assert.equal(toBN(await shortToken.methods.balanceOf(trader).call()).toString(), toWei("0"));

      // The trader should have no short tokens as they were all sold when minting.
      assert.equal(toBN(await longToken.methods.balanceOf(trader).call()).toString(), toWei("0"));

      // The broker should have 0 tokens (long,short and collateral) in it after the trade.
      assert.equal(
        toBN(await longToken.methods.balanceOf(lspUniswapV2Broker.options.address).call()).toString(),
        toWei("0")
      );
      assert.equal(
        toBN(await shortToken.methods.balanceOf(lspUniswapV2Broker.options.address).call()).toString(),
        toWei("0")
      );
      assert.equal(
        toBN(await collateralToken.methods.balanceOf(lspUniswapV2Broker.options.address).call()).toString(),
        toWei("0")
      );

      // The trader should have the expected number of LP tokens expected as the lpTokensPerCollateral*collateral used.
      // As the pool is at an exact 50/50 ratio there should be no slippage on entering the LP position.
      assert.equal(
        (await lpToken.methods.balanceOf(trader).call()).toString(),
        lpTokensPerCollateral // how many LP tokens should be issued per unit collateral
          .mul(toBN(toWei("1000"))) // the number of collateral units used in minting
          .div(toBN(toWei("1"))) // correct scalling factor
          .toString()
      );

      // Next, the trader removes their liquidity to validate they get back the right number of long/short tokens.
      await lpToken.methods.approve(router.options.address, MAX_UINT_VAL).send({ from: trader });

      await router.methods
        .removeLiquidity(
          longToken.options.address,
          shortToken.options.address,
          (await lpToken.methods.balanceOf(trader).call()).toString(),
          "0",
          "0",
          trader,
          MAX_UINT_VAL
        )
        .send({ from: trader });

      // Trader should get back the exact number of long and short tokens with no slippage on either side.
      assert.equal(toBN(await lpToken.methods.balanceOf(trader).call()).toString(), toWei("0"));
      assert.equal(toBN(await longToken.methods.balanceOf(trader).call()).toString(), toWei("1000"));
      assert.equal(toBN(await shortToken.methods.balanceOf(trader).call()).toString(), toWei("1000"));

      // There should be no swap events as the pools are in perfect ratio with the minted tokens.
      assert.equal((await pair.getPastEvents("Swap")).length, 0);
    });
    it("Can correctly mint and LP in one transaction with pool in unequal ratio with long>short", async function () {
      // Add 1000000 long and 100000 short. this makes the price 1000000/100000 long/short. In other words every short is
      // worth 10 long. When LPing we will be market selling longs for shorts to reach the appropriate ratio.
      await addLiquidityToPool(longToken, shortToken, toWei("1000000"), toWei("100000"));

      await lspUniswapV2Broker.methods
        .atomicMintAddLiquidity(
          true, // tradingAsEOA. true as calling from an EOA (not DSProxy).
          longShortPair.options.address, // longShortPair. address to mint tokens against.
          router.options.address, // router. uniswap v2 router to execute trades
          toWei("1000"), // collateralToMintWith. we will use 1000 units of collateral to mint 1000 long and 1000 short tokens.
          "0", // minLpTokens. Sets minimum number of LP tokens to get sent back. Set to 0 to ensure no revert on this param.
          MAX_UINT_VAL // deadline. Set far in the future to not hit this.
        )
        .send({ from: trader });

      const poolLongBalPostAdd = toBN(await longToken.methods.balanceOf(pair.options.address).call());
      const poolShortBalPostAdd = toBN(await shortToken.methods.balanceOf(pair.options.address).call());

      // The trader should no collateral left (spent all 1000).
      assert.equal((await collateralToken.methods.balanceOf(trader).call()).toString(), toWei("0"));

      // The trader should have minimal short or long tokens in their wallet. This is the "dust" sent back to them after
      // minting and LPing. validate that it's less than 500 wei.
      assert.isTrue(toBN(await shortToken.methods.balanceOf(trader).call()).lt(toBN("500")));
      assert.isTrue(toBN(await longToken.methods.balanceOf(trader).call()).lt(toBN("500")));

      // The broker should have 0 tokens (long,short, collateral or LP tokens) in it after the trade.
      assert.equal(
        toBN(await longToken.methods.balanceOf(lspUniswapV2Broker.options.address).call()).toString(),
        toWei("0")
      );
      assert.equal(
        toBN(await shortToken.methods.balanceOf(lspUniswapV2Broker.options.address).call()).toString(),
        toWei("0")
      );
      assert.equal(
        toBN(await collateralToken.methods.balanceOf(lspUniswapV2Broker.options.address).call()).toString(),
        toWei("0")
      );
      assert.equal(
        toBN(await lpToken.methods.balanceOf(lspUniswapV2Broker.options.address).call()).toString(),
        toWei("0")
      );

      // calculate the longPerLp & shortPerLp. i.e for each LP token an address has, what is the redemption rate for
      // one long and one short token.
      const adjustment = toWei(toBN("1"));
      const longPerLp = toBN(await longToken.methods.balanceOf(pair.options.address).call())
        .mul(adjustment)
        .div(toBN(await lpToken.methods.totalSupply().call()));
      const shortPerLp = toBN(await shortToken.methods.balanceOf(pair.options.address).call())
        .mul(adjustment)
        .div(toBN(await lpToken.methods.totalSupply().call()));

      // Next, the trader removes their liquidity to validate they get back the right number of long/short tokens.
      await lpToken.methods.approve(router.options.address, MAX_UINT_VAL).send({ from: trader });

      const traderLpBalance = toBN(await lpToken.methods.balanceOf(trader).call());

      await router.methods
        .removeLiquidity(
          longToken.options.address,
          shortToken.options.address,
          traderLpBalance.toString(),
          "0",
          "0",
          trader,
          MAX_UINT_VAL
        )
        .send({ from: trader });

      // Trader should get back tokens in the exact ratio that the pair has between long and short tokens. This should be
      // approximately equal to a 100:1 ratio, as this is the rate the pool was seeded at (error introduced by single
      // sided deposit that will make this not exactly 100:1) and should be exactly equal to the ratio from the previous calc.
      // In these calculations we check that the output is within 0.01 wei of the expected value.
      assert.equal((await lpToken.methods.balanceOf(trader).call()).toString(), toWei("0"));

      const longTraderBalance = toBN(await longToken.methods.balanceOf(trader).call());
      const shortTraderBalance = toBN(await shortToken.methods.balanceOf(trader).call());

      assert.isTrue(
        longTraderBalance.add(toBN(toWei("0.01"))).gt(longPerLp.mul(traderLpBalance).div(adjustment)) &&
          longTraderBalance.sub(toBN(toWei("0.01"))).lt(longPerLp.mul(traderLpBalance).div(adjustment))
      );
      assert.isTrue(
        shortTraderBalance.add(toBN(toWei("0.01"))).gt(shortPerLp.mul(traderLpBalance).div(adjustment)) &&
          shortTraderBalance.sub(toBN(toWei("0.01"))).lt(shortPerLp.mul(traderLpBalance).div(adjustment))
      );

      // Finally, the ratio of long to short tokens that the trader gets back should be exactly equal to the ratio of
      // long to short tokens in the pool post addition of tokens. Validate this is the case withing a 10 wei error on
      // each side. This verifies that the number returned is correctly proportional to that deposited.
      const walletRatio = longTraderBalance.mul(adjustment).div(shortTraderBalance);
      const poolRatio = poolLongBalPostAdd.mul(adjustment).div(poolShortBalPostAdd);

      assert.isTrue(walletRatio.addn(10).gte(poolRatio) && walletRatio.subn(10).lte(poolRatio));
    });
    it("Can correctly mint and LP in one transaction with pool in unequal ratio with long<short", async function () {
      // Add 100000 long and 1000000 short. this makes the price 100000/1000000 long/short. In other words every short is
      // worth 0.01 long. When LPing we will be market selling longs for shorts to reach the appropriate ratio.
      await addLiquidityToPool(longToken, shortToken, toWei("100000"), toWei("1000000"));

      await lspUniswapV2Broker.methods
        .atomicMintAddLiquidity(
          true, // tradingAsEOA. true as calling from an EOA (not DSProxy).
          longShortPair.options.address, // longShortPair. address to mint tokens against.
          router.options.address, // router. uniswap v2 router to execute trades
          toWei("1000"), // collateralToMintWith. we will use 1000 units of collateral to mint 1000 long and 1000 short tokens.
          "0", // minLpTokens. Sets minimum number of LP tokens to get sent back. Set to 0 to ensure no revert on this param.
          MAX_UINT_VAL // deadline. Set far in the future to not hit this.
        )
        .send({ from: trader });

      const poolLongBalPostAdd = toBN(await longToken.methods.balanceOf(pair.options.address).call());
      const poolShortBalPostAdd = toBN(await shortToken.methods.balanceOf(pair.options.address).call());

      // The trader should no collateral left (spent all 1000).
      assert.equal((await collateralToken.methods.balanceOf(trader).call()).toString(), toWei("0"));

      // The trader should have minimal short or long tokens in their wallet. This is the "dust" sent back to them after
      // minting and LPing. validate that it's less than 50 wei.
      assert.isTrue(toBN(await shortToken.methods.balanceOf(trader).call()).lt(toBN(toWei("0.1"))));
      assert.isTrue(toBN(await longToken.methods.balanceOf(trader).call()).lt(toBN(toWei("0.1"))));

      // The broker should have 0 tokens (long,short, collateral or LP tokens) in it after the trade.
      assert.equal(
        toBN(await longToken.methods.balanceOf(lspUniswapV2Broker.options.address).call()).toString(),
        toWei("0")
      );
      assert.equal(
        toBN(await shortToken.methods.balanceOf(lspUniswapV2Broker.options.address).call()).toString(),
        toWei("0")
      );
      assert.equal(
        toBN(await collateralToken.methods.balanceOf(lspUniswapV2Broker.options.address).call()).toString(),
        toWei("0")
      );
      assert.equal(
        toBN(await lpToken.methods.balanceOf(lspUniswapV2Broker.options.address).call()).toString(),
        toWei("0")
      );

      // calculate the longPerLp & shortPerLp. i.e for each LP token an address has, what is the redemption rate for
      // one long and one short token.
      const adjustment = toWei(toBN("1"));
      const longPerLp = toBN(await longToken.methods.balanceOf(pair.options.address).call())
        .mul(adjustment)
        .div(toBN(await lpToken.methods.totalSupply().call()));
      const shortPerLp = toBN(await shortToken.methods.balanceOf(pair.options.address).call())
        .mul(adjustment)
        .div(toBN(await lpToken.methods.totalSupply().call()));

      // Next, the trader removes their liquidity to validate they get back the right number of long/short tokens.
      await lpToken.methods.approve(router.options.address, MAX_UINT_VAL).send({ from: trader });

      const traderLpBalance = toBN(await lpToken.methods.balanceOf(trader).call());

      await router.methods
        .removeLiquidity(
          longToken.options.address,
          shortToken.options.address,
          traderLpBalance.toString(),
          "0",
          "0",
          trader,
          MAX_UINT_VAL
        )
        .send({ from: trader });

      // Trader should get back tokens in the exact ratio that the pair has between long and short tokens. This should be
      // approximately equal to a 100:1 ratio, as this is the rate the pool was seeded at (error introduced by single
      // sided deposit that will make this not exactly 100:1) and should be exactly equal to the ratio from the previous calc.
      // In these calculations we check that the output is within 0.01 of the expected value.
      assert.equal((await lpToken.methods.balanceOf(trader).call()).toString(), toWei("0"));

      const longTraderBalance = toBN(await longToken.methods.balanceOf(trader).call());

      const shortTraderBalance = toBN(await shortToken.methods.balanceOf(trader).call());

      assert.isTrue(
        longTraderBalance.add(toBN(toWei("0.01"))).gt(longPerLp.mul(traderLpBalance).div(adjustment)) &&
          longTraderBalance.sub(toBN(toWei("0.01"))).lt(longPerLp.mul(traderLpBalance).div(adjustment))
      );
      assert.isTrue(
        shortTraderBalance.add(toBN(toWei("0.01"))).gt(shortPerLp.mul(traderLpBalance).div(adjustment)) &&
          shortTraderBalance.sub(toBN(toWei("0.01"))).lt(shortPerLp.mul(traderLpBalance).div(adjustment))
      );

      // Finally, the ratio of long to short tokens that the trader gets back should be exactly equal to the ratio of
      // long to short tokens in the pool post addition of tokens. Validate this is the case withing a 10 wei error on
      // each side. This verifies that the number returned is correctly proportional to that deposited.
      const walletRatio = longTraderBalance.mul(adjustment).div(shortTraderBalance);
      const poolRatio = poolLongBalPostAdd.mul(adjustment).div(poolShortBalPostAdd);

      assert.isTrue(
        walletRatio.add(toBN(toWei("0.00001"))).gte(poolRatio) && walletRatio.sub(toBN(toWei("0.00001"))).lte(poolRatio)
      );
    });
    it("Can correctly mint and LP in one transaction with very high slippage long>short", async function () {
      // Add 1000000 long and 1000 short. this makes the price 1000000/1000=1000 long/short. In other words every short is
      // worth 1000 long. When LPing we will be market selling longs for shorts to reach the appropriate ratio.
      await addLiquidityToPool(longToken, shortToken, toWei("1000000"), toWei("1000"));

      await lspUniswapV2Broker.methods
        .atomicMintAddLiquidity(
          true, // tradingAsEOA. true as calling from an EOA (not DSProxy).
          longShortPair.options.address, // longShortPair. address to mint tokens against.
          router.options.address, // router. uniswap v2 router to execute trades
          toWei("1000"), // collateralToMintWith. we will use 1000 units of collateral to mint 1000 long and 1000 short tokens.
          "0", // minLpTokens. Sets minimum number of LP tokens to get sent back. Set to 0 to ensure no revert on this param.
          MAX_UINT_VAL // deadline. Set far in the future to not hit this.
        )
        .send({ from: trader });

      const poolLongBalPostAdd = toBN(await longToken.methods.balanceOf(pair.options.address).call());
      const poolShortBalPostAdd = toBN(await shortToken.methods.balanceOf(pair.options.address).call());

      // The trader should no collateral left (spent all 1000).
      assert.equal((await collateralToken.methods.balanceOf(trader).call()).toString(), toWei("0"));

      // The trader should have minimal short or long tokens in their wallet. This is the "dust" sent back to them after
      // minting and LPing. validate that it's less than 1500 wei.

      assert.isTrue(toBN(await shortToken.methods.balanceOf(trader).call()).lt(toBN("1500")));
      assert.isTrue(toBN(await longToken.methods.balanceOf(trader).call()).lt(toBN("1500")));

      // The broker should have 0 tokens (long,short, collateral or LP tokens) in it after the trade.
      assert.equal(
        (await longToken.methods.balanceOf(lspUniswapV2Broker.options.address).call()).toString(),
        toWei("0")
      );
      assert.equal(
        (await shortToken.methods.balanceOf(lspUniswapV2Broker.options.address).call()).toString(),
        toWei("0")
      );
      assert.equal(
        (await collateralToken.methods.balanceOf(lspUniswapV2Broker.options.address).call()).toString(),
        toWei("0")
      );
      assert.equal((await lpToken.methods.balanceOf(lspUniswapV2Broker.options.address).call()).toString(), toWei("0"));

      // calculate the longPerLp & shortPerLp. i.e for each LP token an address has, what is the redemption rate for
      // one long and one short token.
      const adjustment = toWei(toBN("1"));
      const longPerLp = toBN(await longToken.methods.balanceOf(pair.options.address).call())
        .mul(adjustment)
        .div(toBN(await lpToken.methods.totalSupply().call()));
      const shortPerLp = toBN(await shortToken.methods.balanceOf(pair.options.address).call())
        .mul(adjustment)
        .div(toBN(await lpToken.methods.totalSupply().call()));

      // Next, the trader removes their liquidity to validate they get back the right number of long/short tokens.
      await lpToken.methods.approve(router.options.address, MAX_UINT_VAL).send({ from: trader });

      const traderLpBalance = toBN(await lpToken.methods.balanceOf(trader).call());

      await router.methods
        .removeLiquidity(
          longToken.options.address,
          shortToken.options.address,
          traderLpBalance.toString(),
          "0",
          "0",
          trader,
          MAX_UINT_VAL
        )
        .send({ from: trader });

      // Trader should get back tokens in the exact ratio that the pair has between long and short tokens. This should be
      // approximately equal to a 100:1 ratio, as this is the rate the pool was seeded at (error introduced by single
      // sided deposit that will make this not exactly 100:1) and should be exactly equal to the ratio from the previous calc.
      // In these calculations we check that the output is within 5000 wei of the expected value.
      assert.equal((await lpToken.methods.balanceOf(trader).call()).toString(), toWei("0"));

      const longTraderBalance = toBN(await longToken.methods.balanceOf(trader).call());
      const shortTraderBalance = toBN(await shortToken.methods.balanceOf(trader).call());

      assert.isTrue(
        longTraderBalance.addn(10000).gt(longPerLp.mul(traderLpBalance).div(adjustment)) &&
          longTraderBalance.subn(10000).lt(longPerLp.mul(traderLpBalance).div(adjustment))
      );
      assert.isTrue(
        shortTraderBalance.addn(10000).gt(shortPerLp.mul(traderLpBalance).div(adjustment)) &&
          shortTraderBalance.subn(10000).lt(shortPerLp.mul(traderLpBalance).div(adjustment))
      );

      // Finally, the ratio of long to short tokens that the trader gets back should be exactly equal to the ratio of
      // long to short tokens in the pool post addition of tokens. Validate this is the case withing a 10 wei error on
      // each side. This verifies that the number returned is correctly proportional to that deposited.
      const walletRatio = longTraderBalance.mul(adjustment).div(shortTraderBalance);
      const poolRatio = poolLongBalPostAdd.mul(adjustment).div(poolShortBalPostAdd);

      assert.isTrue(walletRatio.addn(1000).gte(poolRatio) && walletRatio.subn(1000).lte(poolRatio));
    });
    it("Can correctly mint and LP in one transaction with very high slippage long<short", async function () {
      // Add 1000 long and 1000000 short. this makes the price 1000/1000000=0.001 long/short. In other words every short is
      // worth 0.001 long. When LPing we will be market selling longs for shorts to reach the appropriate ratio.
      await addLiquidityToPool(longToken, shortToken, toWei("1000"), toWei("1000000"));

      await lspUniswapV2Broker.methods
        .atomicMintAddLiquidity(
          true, // tradingAsEOA. true as calling from an EOA (not DSProxy).
          longShortPair.options.address, // longShortPair. address to mint tokens against.
          router.options.address, // router. uniswap v2 router to execute trades
          toWei("1000"), // collateralToMintWith. we will use 1000 units of collateral to mint 1000 long and 1000 short tokens.
          "0", // minLpTokens. Sets minimum number of LP tokens to get sent back. Set to 0 to ensure no revert on this param.
          MAX_UINT_VAL // deadline. Set far in the future to not hit this.
        )
        .send({ from: trader });

      const poolLongBalPostAdd = toBN(await longToken.methods.balanceOf(pair.options.address).call());
      const poolShortBalPostAdd = toBN(await shortToken.methods.balanceOf(pair.options.address).call());

      // The trader should no collateral left (spent all 1000).
      assert.equal((await collateralToken.methods.balanceOf(trader).call()).toString(), toWei("0"));

      // The trader should have minimal short or long tokens in their wallet. This is the "dust" sent back to them after
      // minting and LPing. validate that it's less than 1.

      assert.isTrue(toBN(await shortToken.methods.balanceOf(trader).call()).lt(toBN(toWei("1"))));
      assert.isTrue(toBN(await longToken.methods.balanceOf(trader).call()).lt(toBN(toWei("1"))));

      // The broker should have 0 tokens (long,short, collateral or LP tokens) in it after the trade.
      assert.equal(
        (await longToken.methods.balanceOf(lspUniswapV2Broker.options.address).call()).toString(),
        toWei("0")
      );
      assert.equal(
        (await shortToken.methods.balanceOf(lspUniswapV2Broker.options.address).call()).toString(),
        toWei("0")
      );
      assert.equal(
        (await collateralToken.methods.balanceOf(lspUniswapV2Broker.options.address).call()).toString(),
        toWei("0")
      );
      assert.equal((await lpToken.methods.balanceOf(lspUniswapV2Broker.options.address).call()).toString(), toWei("0"));

      // calculate the longPerLp & shortPerLp. i.e for each LP token an address has, what is the redemption rate for
      // one long and one short token.
      const adjustment = toWei(toBN("1"));
      const longPerLp = toBN(await longToken.methods.balanceOf(pair.options.address).call())
        .mul(adjustment)
        .div(toBN(await lpToken.methods.totalSupply().call()));
      const shortPerLp = toBN(await shortToken.methods.balanceOf(pair.options.address).call())
        .mul(adjustment)
        .div(toBN(await lpToken.methods.totalSupply().call()));

      // Next, the trader removes their liquidity to validate they get back the right number of long/short tokens.
      await lpToken.methods.approve(router.options.address, MAX_UINT_VAL).send({ from: trader });

      const traderLpBalance = toBN(await lpToken.methods.balanceOf(trader).call());

      await router.methods
        .removeLiquidity(
          longToken.options.address,
          shortToken.options.address,
          traderLpBalance.toString(),
          "0",
          "0",
          trader,
          MAX_UINT_VAL
        )
        .send({ from: trader });

      // Trader should get back tokens in the exact ratio that the pair has between long and short tokens. This should be
      // approximately equal to a 100:1 ratio, as this is the rate the pool was seeded at (error introduced by single
      // sided deposit that will make this not exactly 100:1) and should be exactly equal to the ratio from the previous calc.
      // In these calculations we check that the output is within a margin of error of the expected value.
      assert.equal((await lpToken.methods.balanceOf(trader).call()).toString(), toWei("0"));

      const longTraderBalance = toBN(await longToken.methods.balanceOf(trader).call());
      const shortTraderBalance = toBN(await shortToken.methods.balanceOf(trader).call());

      assert.isTrue(
        longTraderBalance.add(toBN(toWei("1"))).gt(longPerLp.mul(traderLpBalance).div(adjustment)) &&
          longTraderBalance.sub(toBN(toWei("1"))).lt(longPerLp.mul(traderLpBalance).div(adjustment))
      );
      assert.isTrue(
        shortTraderBalance.add(toBN(toWei("1"))).gt(shortPerLp.mul(traderLpBalance).div(adjustment)) &&
          shortTraderBalance.sub(toBN(toWei("1"))).lt(shortPerLp.mul(traderLpBalance).div(adjustment))
      );

      // Finally, the ratio of long to short tokens that the trader gets back should be exactly equal to the ratio of
      // long to short tokens in the pool post addition of tokens. Validate this is the case withing a 10 wei error on
      // each side. This verifies that the number returned is correctly proportional to that deposited.
      const walletRatio = longTraderBalance.mul(adjustment).div(shortTraderBalance);
      const poolRatio = poolLongBalPostAdd.mul(adjustment).div(poolShortBalPostAdd);

      assert.isTrue(
        walletRatio.add(toBN(toWei("1"))).gte(poolRatio) && walletRatio.sub(toBN(toWei("1"))).lte(poolRatio)
      );
    });
  });
});
