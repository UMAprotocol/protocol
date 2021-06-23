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
const { getTruffleContract } = require("@uma/core");
const { toWei, toBN, utf8ToHex, fromWei } = web3.utils;

// Tested Contract
const LspUniswapV2Broker = getContract("LspUniswapV2Broker");
const Token = getContract("ExpandedERC20");
const WETH9 = getContract("WETH9");

// Helper Contracts
const UniswapV2Factory = require("@uniswap/v2-core/build/UniswapV2Factory.json");
const IUniswapV2Pair = require("@uniswap/v2-core/build/IUniswapV2Pair.json");
const UniswapV2Router02 = require("@uniswap/v2-periphery/build/UniswapV2Router02.json");
const DSProxyFactory = getTruffleContract("DSProxyFactory", web3);
const DSProxy = getTruffleContract("DSProxy", web3);
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
const priceFeedIdentifier = utf8ToHex("TEST_IDENTIFIER");
const collateralPerPair = toWei("1"); // each pair of long and short tokens need 1 unit of collateral to mint.
const prepaidProposerReward = toWei("0");

// Returns the current spot price of a uniswap pool, scaled to `precision` # decimal points.
const getPoolSpotPrice = async (tokenA, tokenB, _pairAddress = pairAddress, precision = 4) => {
  const poolTokenABallance = await tokenA.methods.balanceOf(_pairAddress).call();
  const poolTokenBBallance = await tokenB.methods.balanceOf(_pairAddress).call();
  return Number(fromWei(poolTokenABallance.mul(toBN(toWei("1"))).div(poolTokenBBallance))).toFixed(precision);
};

// For a given amountIn, return the amount out expected from a trade. aToB defines the direction of the trade. If aToB
// is true then the trader is exchanging token a for token b. Else, exchanging token b for token a.
const getAmountOut = async (tokenA, tokenB, amountIn, aToB, _pairAddress = pairAddress) => {
  const [reserveIn, reserveOut] = aToB
    ? await Promise.all([tokenA.balanceOf(_pairAddress), tokenB.balanceOf(_pairAddress)])
    : await Promise.all([tokenB.balanceOf(_pairAddress), tokenA.balanceOf(_pairAddress)]);
  const amountInWithFee = toBN(amountIn).muln(997);
  const numerator = amountInWithFee.mul(reserveOut);
  const denominator = reserveIn.muln(1000).add(amountInWithFee);
  return numerator.div(denominator);
};

contract("LspUniswapV2Broker", function (accounts) {
  const deployer = accounts[0];
  const trader = accounts[1];

  beforeEach(async () => {
    await runDefaultFixture(hre);
    dsProxyFactory = await DSProxyFactory.new().send({ from: accounts[0] });

    const WETH = await WETH9.new().send({ from: accounts[0] });
    // deploy Uniswap V2 Factory & router.
    factory = await createContractObjectFromJson(UniswapV2Factory, web3).new(deployer, { from: deployer });
    router = await createContractObjectFromJson(UniswapV2Router02, web3).new(factory.options.address, WETH.address, {
      from: deployer,
    });

    // create a LspUniswapV2Broker
    lspUniswapV2Broker = await LspUniswapV2Broker.new().send({ from: accounts[0] });

    finder = await Finder.deployed();
    timer = await Timer.deployed();
    collateralWhitelist = await AddressWhitelist.deployed();

    identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.methods.addSupportedIdentifier(priceFeedIdentifier).send({ from: deployer });

    // Force each test to start with a simulated time that's synced to the startTimestamp.
    await timer.methods.setCurrentTime(startTimestamp).send({ from: accounts[0] });

    // Create the LSP

    collateralToken = await Token.new("Wrapped Ether", "WETH", 18).send({ from: accounts[0] }).send({ from: deployer });
    await collateralToken.methods.addMember(1, deployer).send({ from: deployer });
    await collateralToken.mint(deployer, toWei("1000000"), { from: deployer });

    await collateralWhitelist.methods.addToWhitelist(collateralToken.options.address).send({ from: accounts[0] });

    longToken = await Token.new("Long Token", "lTKN", 18).send({ from: accounts[0] }).send({ from: deployer });
    shortToken = await Token.new("Short Token", "sTKN", 18).send({ from: accounts[0] }).send({ from: deployer });

    optimisticOracle = await OptimisticOracle.new(
      optimisticOracleLiveness,
      finder.options.address,
      timer.options.address
    ).send({ from: accounts[0] });
    await finder.methods.changeImplementationAddress(
      utf8ToHex(interfaceName.OptimisticOracle),
      optimisticOracle.options.address,
      { from: deployer }
    );

    // Create LSP library and LSP contract.
    longShortPairLibrary = await LongShortPairFinancialProjectLibraryTest.new().send({ from: accounts[0] });

    longShortPair = await LongShortPair.new(
      expirationTimestamp,
      collateralPerPair,
      priceFeedIdentifier,
      longToken.options.address,
      shortToken.options.address,
      collateralToken.options.address,
      finder.options.address,
      longShortPairLibrary.options.address,
      ancillaryData,
      prepaidProposerReward,
      timer.options.address
    ).send({ from: accounts[0] });

    // Add mint and burn roles for the long and short tokens to the long short pair.
    await longToken.methods.addMember(1, longShortPair.options.address).send({ from: deployer });
    await shortToken.methods.addMember(1, longShortPair.options.address).send({ from: deployer });
    await longToken.methods.addMember(2, longShortPair.options.address).send({ from: deployer });
    await shortToken.methods.addMember(2, longShortPair.options.address).send({ from: deployer });
  });

  describe("atomicMintSellOneSide: AMM contains Long against Short token", () => {
    beforeEach(async () => {
      // Initialize the UniV2 pool. For this set of tests the long and short tokens are tokenA and tokenB in the pool.
      await factory.methods.createPair(shortToken.options.address, longToken.options.address).send({ from: deployer });
      pairAddress = await factory.methods.getPair(shortToken.options.address, longToken.options.address).call();
      pair = await createContractObjectFromJson(IUniswapV2Pair, web3).at(pairAddress);

      // Next, mint some tokens from the LSP and add liquidity to the AMM. Add 100000 long and short tokens. From
      // this the starting price will be 1 long/short.
      await collateralToken.approve(longShortPair.options.address, toWei("100000"));
      await longShortPair.create(toWei("100000"));

      await longToken.approve(router.options.address, toWei("100000"));
      await shortToken.approve(router.options.address, toWei("100000"));
      await router.addLiquidity(
        longToken.options.address,
        shortToken.options.address,
        toWei("100000"),
        toWei("100000"),
        "0",
        "0",
        deployer,
        MAX_UINT_VAL,
        { from: deployer }
      );
      assert.equal((await longToken.methods.balanceOf(pair.options.address).call()).toString(), toWei("100000"));
      assert.equal((await shortToken.methods.balanceOf(pair.options.address).call()).toString(), toWei("100000"));
      assert.equal(await getPoolSpotPrice(longToken, shortToken), "1.0000"); // price should be exactly 1000 TokenA/TokenB.})

      // Mint EOA some collateral:
      await collateralToken.mint(trader, toWei("1000"), { from: deployer });
      assert.equal((await collateralToken.methods.balanceOf(trader).call()).toString(), toWei("1000"));
      await collateralToken.approve(lspUniswapV2Broker.options.address, toWei("1000"), { from: trader });
    });

    it("Can correctly mint and go long in one transaction", async function () {
      // Calculate the expected long purchased with the short  from the trade before the trade is done (initial reserves).
      const longFromSale = await getAmountOut(shortToken, longToken, toWei("1000"), true);

      await lspUniswapV2Broker.atomicMintSellOneSide(
        true, // tradingAsEOA. true as calling from an EOA (not DSProxy).
        true, // tradingLong. we want to hold long tokens after the call.
        longShortPair.options.address, // longShortPair. address to mint tokens against.
        router.options.address, // router. uniswap v2 router to execute trades
        toWei("1000"), // collateralToMintWith. we will use 1000 units of collateral to mint 1000 long and 1000 short tokens.
        [shortToken.options.address, longToken.options.address], // swapPath. exchange the short tokens for long tokens.
        MAX_UINT_VAL, // unreachable deadline
        { from: trader }
      );

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

      await lspUniswapV2Broker.atomicMintSellOneSide(
        true, // tradingAsEOA. true as calling from an EOA (not DSProxy).
        false, // tradingLong. we want to hold short tokens after the call so set to false (short trade).
        longShortPair.options.address, // longShortPair. address to mint tokens against.
        router.options.address, // router. uniswap v2 router to execute trades
        toWei("1000"), // collateralToMintWith. we will use 1000 units of collateral to mint 1000 long and 1000 short tokens.
        [longToken.options.address, shortToken.options.address], // swapPath. exchange the long tokens for short tokens.
        MAX_UINT_VAL, // unreachable deadline
        { from: trader }
      );

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
          lspUniswapV2Broker.atomicMintSellOneSide(
            true,
            false,
            ZERO_ADDRESS, // Zero address
            router.options.address,
            toWei("1000"),
            [longToken.options.address, shortToken.options.address],
            MAX_UINT_VAL,
            { from: trader }
          )
        )
      );
      assert(
        await didContractThrow(
          lspUniswapV2Broker.atomicMintSellOneSide(
            true,
            false,
            router.options.address, // Not an LSP contract
            router.options.address,
            toWei("1000"),
            [longToken.options.address, shortToken.options.address],
            MAX_UINT_VAL,
            { from: trader }
          )
        )
      );

      // Invalid router contract
      assert(
        await didContractThrow(
          lspUniswapV2Broker.atomicMintSellOneSide(
            true,
            false,
            longShortPair.options.address,
            ZERO_ADDRESS, // Zero address
            toWei("1000"),
            [longToken.options.address, shortToken.options.address],
            MAX_UINT_VAL,
            { from: trader }
          )
        )
      );
      assert(
        await didContractThrow(
          lspUniswapV2Broker.atomicMintSellOneSide(
            true,
            false,
            longShortPair.options.address,
            longShortPair.options.address, // Not a router contract
            toWei("1000"),
            [longToken.options.address, shortToken.options.address],
            MAX_UINT_VAL,
            { from: trader }
          )
        )
      );

      // Cannot mint with 0 collateral
      assert(
        await didContractThrow(
          lspUniswapV2Broker.atomicMintSellOneSide(
            true,
            false,
            longShortPair.options.address,
            router.options.address,
            "0",
            [longToken.options.address, shortToken.options.address],
            MAX_UINT_VAL,
            { from: trader }
          )
        )
      );

      // Swap path doesn't have sold token as first token.
      assert(
        await didContractThrow(
          lspUniswapV2Broker.atomicMintSellOneSide(
            true, // Selling long token, but long token is not first token in swapPath param.
            false,
            longShortPair.options.address,
            router.options.address,
            toWei("1000"),
            [shortToken.options.address, longShortPair.options.address],
            MAX_UINT_VAL,
            { from: trader }
          )
        )
      );
    });

    it("Caller is a DSProxy", async function () {
      // Finally, create a DSProxy for the caller. This will be used to send mint the LSP position from.
      await dsProxyFactory.methods.build({ from: trader }).send({ from: accounts[0] });
      dsProxy = await DSProxy.at((await dsProxyFactory.getPastEvents("Created"))[0].returnValues.proxy);

      // Send collateral to DSProxy it can use to deposit into LSP:
      await collateralToken.transfer(dsProxy.options.address, toWei("1000"), { from: trader });
      assert.equal((await collateralToken.methods.balanceOf(dsProxy.options.address).call()).toString(), toWei("1000"));

      // Calculate the expected long purchased with the short  from the trade before the trade is done (initial reserves).
      const longFromSale = await getAmountOut(shortToken, longToken, toWei("1000"), true);

      // Execute mint+sell via DSProxy:
      const callData = lspUniswapV2Broker.contract.methods
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
      await dsProxy.contract.methods["execute(address,bytes)"](lspUniswapV2Broker.options.address, callData).send({
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
      pair1 = await createContractObjectFromJson(IUniswapV2Pair, web3).at(pair1Address);
      pair2 = await createContractObjectFromJson(IUniswapV2Pair, web3).at(pair2Address);

      // Next, mint some tokens from the LSP and add liquidity to the AMMs. Add 100000 long and short tokens. From
      // this the starting price will be 1 long/short against 1 collateral.
      await collateralToken.approve(longShortPair.options.address, toWei("100000"));
      await longShortPair.create(toWei("100000"));

      await longToken.approve(router.options.address, toWei("100000"));
      await shortToken.approve(router.options.address, toWei("100000"));
      await collateralToken.approve(router.options.address, toWei("200000"));
      await router.addLiquidity(
        longToken.options.address,
        collateralToken.options.address,
        toWei("100000"),
        toWei("100000"),
        "0",
        "0",
        deployer,
        MAX_UINT_VAL,
        { from: deployer }
      );
      await router.addLiquidity(
        shortToken.options.address,
        collateralToken.options.address,
        toWei("100000"),
        toWei("100000"),
        "0",
        "0",
        deployer,
        MAX_UINT_VAL,
        { from: deployer }
      );
      assert.equal((await longToken.methods.balanceOf(pair1.options.address).call()).toString(), toWei("100000"));
      assert.equal((await collateralToken.methods.balanceOf(pair1.options.address).call()).toString(), toWei("100000"));
      assert.equal((await shortToken.methods.balanceOf(pair2.options.address).call()).toString(), toWei("100000"));
      assert.equal((await collateralToken.methods.balanceOf(pair2.options.address).call()).toString(), toWei("100000"));
      assert.equal(await getPoolSpotPrice(longToken, collateralToken, pair1Address), "1.0000");
      assert.equal(await getPoolSpotPrice(shortToken, collateralToken, pair2Address), "1.0000");

      // Mint EOA some collateral:
      await collateralToken.mint(trader, toWei("1000"), { from: deployer });
      assert.equal((await collateralToken.methods.balanceOf(trader).call()).toString(), toWei("1000"));
      await collateralToken.approve(lspUniswapV2Broker.options.address, toWei("1000"), { from: trader });
    });

    it("Can correctly mint and go long in one transaction", async function () {
      // Calculate the expected long purchased with the short from the 2-hop trade. We expect this to be return the user
      // fewer long tokens than they would get if there were a 1-hop trade available from a short-long pool.
      const collateralFromSale = await getAmountOut(shortToken, collateralToken, toWei("1000"), true, pair2Address);
      const longFromSale = await getAmountOut(collateralToken, longToken, collateralFromSale, true, pair1Address);

      await lspUniswapV2Broker.atomicMintSellOneSide(
        true, // tradingAsEOA. true as calling from an EOA (not DSProxy).
        true, // tradingLong. we want to hold long tokens after the call.
        longShortPair.options.address, // longShortPair. address to mint tokens against.
        router.options.address, // router. uniswap v2 router to execute trades
        toWei("1000"), // collateralToMintWith. we will use 1000 units of collateral to mint 1000 long and 1000 short tokens.
        [shortToken.options.address, collateralToken.options.address, longToken.options.address], // swapPath.
        MAX_UINT_VAL, // unreachable deadline
        { from: trader }
      );

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

      await lspUniswapV2Broker.atomicMintSellOneSide(
        true, // tradingAsEOA. true as calling from an EOA (not DSProxy).
        false, // tradingLong. we want to hold short tokens after the call so set to false (short trade).
        longShortPair.options.address, // longShortPair. address to mint tokens against.
        router.options.address, // router. uniswap v2 router to execute trades
        toWei("1000"), // collateralToMintWith. we will use 1000 units of collateral to mint 1000 long and 1000 short tokens.
        [longToken.options.address, collateralToken.options.address, shortToken.options.address], // swapPath.
        MAX_UINT_VAL, // unreachable deadline
        { from: trader }
      );

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
});
