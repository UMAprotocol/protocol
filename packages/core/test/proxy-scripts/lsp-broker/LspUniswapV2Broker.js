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
const LspUniswapV2Broker = artifacts.require("LspUniswapV2Broker");
const Token = artifacts.require("ExpandedERC20");
const WETH9 = artifacts.require("WETH9");

// Helper Contracts
const UniswapV2Factory = require("@uniswap/v2-core/build/UniswapV2Factory.json");
const IUniswapV2Pair = require("@uniswap/v2-core/build/IUniswapV2Pair.json");
const UniswapV2Router02 = require("@uniswap/v2-periphery/build/UniswapV2Router02.json");
const DSProxyFactory = getTruffleContract("DSProxyFactory", web3);
const DSProxy = getTruffleContract("DSProxy", web3);

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
const priceFeedIdentifier = utf8ToHex("TEST_IDENTIFIER");
const collateralPerPair = toWei("1"); // each pair of long and short tokens need 1 unit of collateral to mint.
const prepaidProposerReward = toWei("0");

// Returns the current spot price of a uniswap pool, scaled to `precision` # decimal points.
const getPoolSpotPrice = async (tokenA, tokenB, _pairAddress = pairAddress, precision = 4) => {
  const poolTokenABallance = await tokenA.balanceOf(_pairAddress);
  const poolTokenBBallance = await tokenB.balanceOf(_pairAddress);
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

  const addLiquidityToPool = async (tokenA, tokenB, longAmount, shortAmount, _pair = pair) => {
    await router.addLiquidity(
      tokenA.address,
      tokenB.address,
      longAmount,
      shortAmount,
      "0",
      "0",
      deployer,
      MAX_UINT_VAL,
      { from: deployer }
    );
    lpToken = await Token.at(_pair.address);

    assert.equal((await tokenA.balanceOf(_pair.address)).toString(), longAmount);
    assert.equal((await tokenB.balanceOf(_pair.address)).toString(), shortAmount);
  };
  before(async () => {
    dsProxyFactory = await DSProxyFactory.new();

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
    await collateralToken.mint(deployer, toWei("10000000"), { from: deployer });

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

    // Initialize the UniV2 pool. For this set of tests the long and short tokens are tokenA and tokenB in the pool.
    await factory.createPair(shortToken.address, longToken.address, { from: deployer });
    pairAddress = await factory.getPair(shortToken.address, longToken.address);
    pair = await createContractObjectFromJson(IUniswapV2Pair, web3).at(pairAddress);
    lpToken = await Token.at(pair.address);

    // Next, mint some tokens from the LSP and add liquidity to the AMM. Add 1000000 long and short tokens. From
    // this the starting price will be 1 long/short.
    await collateralToken.approve(longShortPair.address, toWei("1000000"));
    await longShortPair.create(toWei("1000000"));

    await longToken.approve(router.address, toWei("1000000"));
    await shortToken.approve(router.address, toWei("1000000"));

    // Mint EOA some collateral to the trader
    await collateralToken.mint(trader, toWei("1000"), { from: deployer });
    await collateralToken.approve(lspUniswapV2Broker.address, toWei("1000"), { from: trader });
  });

  describe("atomicMintSellOneSide: AMM contains Long against Short token", () => {
    beforeEach(async () => {
      await addLiquidityToPool(longToken, shortToken, toWei("100000"), toWei("100000"));
    });

    it("Can correctly mint and go long in one transaction", async function () {
      // Calculate the expected long purchased with the short  from the trade before the trade is done (initial reserves).
      const longFromSale = await getAmountOut(shortToken, longToken, toWei("1000"), true);

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
      // Calculate the expected short purchased with the long  from the trade before the trade is done (initial reserves).
      const shortFromSale = await getAmountOut(longToken, shortToken, toWei("1000"), true);

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

    it("Invalid params", async function () {
      // Invalid LSP contract
      assert(
        await didContractThrow(
          lspUniswapV2Broker.atomicMintSellOneSide(
            true,
            false,
            ZERO_ADDRESS, // Zero address
            router.address,
            toWei("1000"),
            [longToken.address, shortToken.address],
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
            router.address, // Not an LSP contract
            router.address,
            toWei("1000"),
            [longToken.address, shortToken.address],
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
            longShortPair.address,
            ZERO_ADDRESS, // Zero address
            toWei("1000"),
            [longToken.address, shortToken.address],
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
            longShortPair.address,
            longShortPair.address, // Not a router contract
            toWei("1000"),
            [longToken.address, shortToken.address],
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
            longShortPair.address,
            router.address,
            "0",
            [longToken.address, shortToken.address],
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
            longShortPair.address,
            router.address,
            toWei("1000"),
            [shortToken.address, longShortPair.address],
            MAX_UINT_VAL,
            { from: trader }
          )
        )
      );
    });

    it("Caller is a DSProxy", async function () {
      // Finally, create a DSProxy for the caller. This will be used to send mint the LSP position from.
      await dsProxyFactory.build({ from: trader });
      dsProxy = await DSProxy.at((await dsProxyFactory.getPastEvents("Created"))[0].returnValues.proxy);

      // Send collateral to DSProxy it can use to deposit into LSP:
      await collateralToken.transfer(dsProxy.address, toWei("1000"), { from: trader });
      assert.equal((await collateralToken.balanceOf(dsProxy.address)).toString(), toWei("1000"));

      // Calculate the expected long purchased with the short  from the trade before the trade is done (initial reserves).
      const longFromSale = await getAmountOut(shortToken, longToken, toWei("1000"), true);

      // Execute mint+sell via DSProxy:
      const callData = lspUniswapV2Broker.contract.methods
        .atomicMintSellOneSide(
          false, // tradingAsEOA. False and pretending to call from a contract like a DSProxy.
          true, // tradingLong. we want the contract to hold long tokens after the call.
          longShortPair.address, // longShortPair. address to mint tokens against.
          router.address, // router. uniswap v2 router to execute trades
          toWei("1000"), // collateralToMintWith. we will use 1000 units of collateral to mint 1000 long and 1000 short tokens.
          [shortToken.address, longToken.address], // swapPath. exchange the short tokens for long tokens.
          MAX_UINT_VAL // unreachable deadline
        )
        .encodeABI();
      await dsProxy.contract.methods["execute(address,bytes)"](lspUniswapV2Broker.address, callData).send({
        from: trader,
      });

      // The DSProxy should no collateral left (spent all 1000).
      assert.equal((await collateralToken.balanceOf(dsProxy.address)).toString(), toWei("0"));

      // The DSProxy should have no short tokens as they were all sold when minting.
      assert.equal((await shortToken.balanceOf(dsProxy.address)).toString(), toWei("0"));

      // The DSProxy should have the exact number of long tokens from minting + those from buying with the sold short side.
      assert.equal(
        (await longToken.balanceOf(dsProxy.address)).toString(),
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
      await factory.createPair(longToken.address, collateralToken.address, { from: deployer });
      await factory.createPair(shortToken.address, collateralToken.address, { from: deployer });
      pair1Address = await factory.getPair(longToken.address, collateralToken.address);
      pair2Address = await factory.getPair(shortToken.address, collateralToken.address);
      pair1 = await createContractObjectFromJson(IUniswapV2Pair, web3).at(pair1Address);
      pair2 = await createContractObjectFromJson(IUniswapV2Pair, web3).at(pair2Address);

      await collateralToken.approve(router.address, toWei("200000"));
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

      await lspUniswapV2Broker.atomicMintSellOneSide(
        true, // tradingAsEOA. true as calling from an EOA (not DSProxy).
        true, // tradingLong. we want to hold long tokens after the call.
        longShortPair.address, // longShortPair. address to mint tokens against.
        router.address, // router. uniswap v2 router to execute trades
        toWei("1000"), // collateralToMintWith. we will use 1000 units of collateral to mint 1000 long and 1000 short tokens.
        [shortToken.address, collateralToken.address, longToken.address], // swapPath.
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
      // Calculate the expected short purchased with the long from the 2-hop trade. We expect this to be return the user
      // fewer short tokens than they would get if there were a 1-hop trade available from a short-long pool.
      const collateralFromSale = await getAmountOut(longToken, collateralToken, toWei("1000"), true, pair1Address);
      const shortFromSale = await getAmountOut(collateralToken, shortToken, collateralFromSale, true, pair2Address);

      await lspUniswapV2Broker.atomicMintSellOneSide(
        true, // tradingAsEOA. true as calling from an EOA (not DSProxy).
        false, // tradingLong. we want to hold short tokens after the call so set to false (short trade).
        longShortPair.address, // longShortPair. address to mint tokens against.
        router.address, // router. uniswap v2 router to execute trades
        toWei("1000"), // collateralToMintWith. we will use 1000 units of collateral to mint 1000 long and 1000 short tokens.
        [longToken.address, collateralToken.address, shortToken.address], // swapPath.
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
  describe("atomicMintAddLiquidity: AMM contains Long against Short token", () => {
    it("Can correctly mint and LP in one transaction with pool in equal ratios", async function () {
      // Mint in exact ratios equal between long and short. There should not be any need for trading as the mint ratio
      // is exactly equal to the pool ratio.
      await addLiquidityToPool(longToken, shortToken, toWei("100000"), toWei("100000"));
      // Calculate how many LP tokens are expected to be minted per unit collateral. Trader added 100000 units of
      // to mint 100000 long and short tokens.
      const lpTokensPerCollateral = (await lpToken.balanceOf(deployer))
        .mul(toBN(toWei("1"))) // scalding factor
        .div(toBN(toWei("100000"))) // number of collateral units used in minting
        .addn(1); // offset to fix rounding error

      await lspUniswapV2Broker.atomicMintAddLiquidity(
        true, // tradingAsEOA. true as calling from an EOA (not DSProxy).
        longShortPair.address, // longShortPair. address to mint tokens against.
        router.address, // router. uniswap v2 router to execute trades
        toWei("1000"), // collateralToMintWith. we will use 1000 units of collateral to mint 1000 long and 1000 short tokens.
        MAX_UINT_VAL,
        { from: trader }
      );

      // The trader should no collateral left (spent all 1000).
      assert.equal((await collateralToken.balanceOf(trader)).toString(), toWei("0"));

      // The trader should have no short tokens as they were all sold when minting.
      assert.equal((await shortToken.balanceOf(trader)).toString(), toWei("0"));

      // The trader should have no short tokens as they were all sold when minting.
      assert.equal((await longToken.balanceOf(trader)).toString(), toWei("0"));

      // The broker should have 0 tokens (long,short and collateral) in it after the trade.
      assert.equal((await longToken.balanceOf(lspUniswapV2Broker.address)).toString(), toWei("0"));
      assert.equal((await shortToken.balanceOf(lspUniswapV2Broker.address)).toString(), toWei("0"));
      assert.equal((await collateralToken.balanceOf(lspUniswapV2Broker.address)).toString(), toWei("0"));

      // The trader should have the expected number of LP tokens expected as the lpTokensPerCollateral*collateral used.
      // As the pool is at an exact 50/50 ratio there should be no slippage on entering the LP position.
      assert.equal(
        (await lpToken.balanceOf(trader)).toString(),
        lpTokensPerCollateral // how many LP tokens should be issued per unit collateral
          .mul(toBN(toWei("1000"))) // the number of collateral units used in minting
          .div(toBN(toWei("1"))) // correct scalling factor
          .toString()
      );

      // Next, the trader removes their liquidity to validate they get back the right number of long/short tokens.
      await lpToken.approve(router.address, MAX_UINT_VAL, { from: trader });

      await router.removeLiquidity(
        longToken.address,
        shortToken.address,
        (await lpToken.balanceOf(trader)).toString(),
        "0",
        "0",
        trader,
        MAX_UINT_VAL,
        { from: trader }
      );

      // Trader should get back the exact number of long and short tokens with no slippage on either side.
      assert.equal((await lpToken.balanceOf(trader)).toString(), toWei("0"));
      assert.equal((await longToken.balanceOf(trader)).toString(), toWei("1000"));
      assert.equal((await shortToken.balanceOf(trader)).toString(), toWei("1000"));
    });
    it("Can correctly mint and LP in one transaction with pool in unequal ratio with long>short", async function () {
      // Add 1000000 long and 100000 short. this makes the price 1000000/100000 long/short. In other words every short is
      // worth 10 long. When LPing we will be market selling longs for shorts to reach the appropriate ratio.
      await addLiquidityToPool(longToken, shortToken, toWei("1000000"), toWei("100000"));

      await lspUniswapV2Broker.atomicMintAddLiquidity(
        true, // tradingAsEOA. true as calling from an EOA (not DSProxy).
        longShortPair.address, // longShortPair. address to mint tokens against.
        router.address, // router. uniswap v2 router to execute trades
        toWei("1000"), // collateralToMintWith. we will use 1000 units of collateral to mint 1000 long and 1000 short tokens.
        MAX_UINT_VAL,
        { from: trader }
      );

      const poolLongBalPostAdd = await longToken.balanceOf(pair.address);
      const poolShortBalPostAdd = await shortToken.balanceOf(pair.address);

      // The trader should no collateral left (spent all 1000).
      assert.equal((await collateralToken.balanceOf(trader)).toString(), toWei("0"));

      // The trader should have minimal short or long tokens in their wallet. This is the "dust" sent back to them after
      // minting and LPing. validate that it's less than 500 wei.
      console.log("BAL", (await shortToken.balanceOf(trader)).toString());
      assert.isTrue((await shortToken.balanceOf(trader)).lt(toBN("500")));
      assert.isTrue((await longToken.balanceOf(trader)).lt(toBN("500")));

      // The broker should have 0 tokens (long,short, collateral or LP tokens) in it after the trade.
      assert.equal((await longToken.balanceOf(lspUniswapV2Broker.address)).toString(), toWei("0"));
      assert.equal((await shortToken.balanceOf(lspUniswapV2Broker.address)).toString(), toWei("0"));
      assert.equal((await collateralToken.balanceOf(lspUniswapV2Broker.address)).toString(), toWei("0"));
      assert.equal((await lpToken.balanceOf(lspUniswapV2Broker.address)).toString(), toWei("0"));

      // calculate the longPerLp & shortPerLp. i.e for each LP token an address has, what is the redemption rate for
      // one long and one short token.
      const adjustment = toWei(toBN("1"));
      const longPerLp = (await longToken.balanceOf(pair.address)).mul(adjustment).div(await lpToken.totalSupply());
      const shortPerLp = (await shortToken.balanceOf(pair.address)).mul(adjustment).div(await lpToken.totalSupply());

      // Next, the trader removes their liquidity to validate they get back the right number of long/short tokens.
      await lpToken.approve(router.address, MAX_UINT_VAL, { from: trader });

      const traderLpBalance = await lpToken.balanceOf(trader);

      await router.removeLiquidity(
        longToken.address,
        shortToken.address,
        traderLpBalance.toString(),
        "0",
        "0",
        trader,
        MAX_UINT_VAL,
        { from: trader }
      );

      // Trader should get back tokens in the exact ratio that the pair has between long and short tokens. This should be
      // approximately equal to a 100:1 ratio, as this is the rate the pool was seeded at (error introduced by single
      // sided deposit that will make this not exactly 100:1) and should be exactly equal to the ratio from the previous calc.
      // In these calculations we check that the output is within 5000 wei of the expected value.
      assert.equal((await lpToken.balanceOf(trader)).toString(), toWei("0"));

      const longTraderBalance = await longToken.balanceOf(trader);
      const shortTraderBalance = await shortToken.balanceOf(trader);

      assert.isTrue(
        longTraderBalance.addn(5000).gt(longPerLp.mul(traderLpBalance).div(adjustment)) &&
          longTraderBalance.subn(5000).lt(longPerLp.mul(traderLpBalance).div(adjustment))
      );
      assert.isTrue(
        shortTraderBalance.addn(5000).gt(shortPerLp.mul(traderLpBalance).div(adjustment)) &&
          shortTraderBalance.subn(5000).lt(shortPerLp.mul(traderLpBalance).div(adjustment))
      );

      // Finally, the ratio of long to short tokens that the trader gets back should be exactly equal to the ratio of
      // long to short tokens in the pool post addition of tokens. Validate this is the case withing a 10 wei error on
      // each side. This verifies that the number returned is correctly proportional to that deposited.
      const walletRatio = longTraderBalance.mul(adjustment).div(shortTraderBalance);
      const poolRatio = poolLongBalPostAdd.mul(adjustment).div(poolShortBalPostAdd);

      assert.isTrue(walletRatio.addn(10).gte(poolRatio) && walletRatio.subn(10).lte(poolRatio));
    });
    it("Can correctly mint and LP in one transaction with pool in unequal ratio with short>long", async function () {
      // Add 100000 long and 1000000 short. this makes the price 100000/1000000 long/short. In other words every short is
      // worth 0.01 long. When LPing we will be market selling longs for shorts to reach the appropriate ratio.
      await addLiquidityToPool(longToken, shortToken, toWei("100000"), toWei("1000000"));

      await lspUniswapV2Broker.atomicMintAddLiquidity(
        true, // tradingAsEOA. true as calling from an EOA (not DSProxy).
        longShortPair.address, // longShortPair. address to mint tokens against.
        router.address, // router. uniswap v2 router to execute trades
        toWei("1000"), // collateralToMintWith. we will use 1000 units of collateral to mint 1000 long and 1000 short tokens.
        MAX_UINT_VAL,
        { from: trader }
      );

      const poolLongBalPostAdd = await longToken.balanceOf(pair.address);
      const poolShortBalPostAdd = await shortToken.balanceOf(pair.address);

      // The trader should no collateral left (spent all 1000).
      assert.equal((await collateralToken.balanceOf(trader)).toString(), toWei("0"));

      // The trader should have minimal short or long tokens in their wallet. This is the "dust" sent back to them after
      // minting and LPing. validate that it's less than 50 wei.
      assert.isTrue((await shortToken.balanceOf(trader)).lt(toBN(toWei("0.1"))));
      assert.isTrue((await longToken.balanceOf(trader)).lt(toBN(toWei("0.1"))));

      // The broker should have 0 tokens (long,short, collateral or LP tokens) in it after the trade.
      assert.equal((await longToken.balanceOf(lspUniswapV2Broker.address)).toString(), toWei("0"));
      assert.equal((await shortToken.balanceOf(lspUniswapV2Broker.address)).toString(), toWei("0"));
      assert.equal((await collateralToken.balanceOf(lspUniswapV2Broker.address)).toString(), toWei("0"));
      assert.equal((await lpToken.balanceOf(lspUniswapV2Broker.address)).toString(), toWei("0"));

      // calculate the longPerLp & shortPerLp. i.e for each LP token an address has, what is the redemption rate for
      // one long and one short token.
      const adjustment = toWei(toBN("1"));
      const longPerLp = (await longToken.balanceOf(pair.address)).mul(adjustment).div(await lpToken.totalSupply());
      const shortPerLp = (await shortToken.balanceOf(pair.address)).mul(adjustment).div(await lpToken.totalSupply());

      // Next, the trader removes their liquidity to validate they get back the right number of long/short tokens.
      await lpToken.approve(router.address, MAX_UINT_VAL, { from: trader });

      const traderLpBalance = await lpToken.balanceOf(trader);

      await router.removeLiquidity(
        longToken.address,
        shortToken.address,
        traderLpBalance.toString(),
        "0",
        "0",
        trader,
        MAX_UINT_VAL,
        { from: trader }
      );

      // Trader should get back tokens in the exact ratio that the pair has between long and short tokens. This should be
      // approximately equal to a 100:1 ratio, as this is the rate the pool was seeded at (error introduced by single
      // sided deposit that will make this not exactly 100:1) and should be exactly equal to the ratio from the previous calc.
      // In these calculations we check that the output is within 5000 wei of the expected value.
      assert.equal((await lpToken.balanceOf(trader)).toString(), toWei("0"));

      const longTraderBalance = await longToken.balanceOf(trader);

      const shortTraderBalance = await shortToken.balanceOf(trader);

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

      await lspUniswapV2Broker.atomicMintAddLiquidity(
        true, // tradingAsEOA. true as calling from an EOA (not DSProxy).
        longShortPair.address, // longShortPair. address to mint tokens against.
        router.address, // router. uniswap v2 router to execute trades
        toWei("1000"), // collateralToMintWith. we will use 1000 units of collateral to mint 1000 long and 1000 short tokens.
        MAX_UINT_VAL,
        { from: trader }
      );

      const poolLongBalPostAdd = await longToken.balanceOf(pair.address);
      const poolShortBalPostAdd = await shortToken.balanceOf(pair.address);

      // The trader should no collateral left (spent all 1000).
      assert.equal((await collateralToken.balanceOf(trader)).toString(), toWei("0"));

      // The trader should have minimal short or long tokens in their wallet. This is the "dust" sent back to them after
      // minting and LPing. validate that it's less than 1500 wei.

      assert.isTrue((await shortToken.balanceOf(trader)).lt(toBN("1500")));
      assert.isTrue((await longToken.balanceOf(trader)).lt(toBN("1500")));

      // The broker should have 0 tokens (long,short, collateral or LP tokens) in it after the trade.
      assert.equal((await longToken.balanceOf(lspUniswapV2Broker.address)).toString(), toWei("0"));
      assert.equal((await shortToken.balanceOf(lspUniswapV2Broker.address)).toString(), toWei("0"));
      assert.equal((await collateralToken.balanceOf(lspUniswapV2Broker.address)).toString(), toWei("0"));
      assert.equal((await lpToken.balanceOf(lspUniswapV2Broker.address)).toString(), toWei("0"));

      // calculate the longPerLp & shortPerLp. i.e for each LP token an address has, what is the redemption rate for
      // one long and one short token.
      const adjustment = toWei(toBN("1"));
      const longPerLp = (await longToken.balanceOf(pair.address)).mul(adjustment).div(await lpToken.totalSupply());
      const shortPerLp = (await shortToken.balanceOf(pair.address)).mul(adjustment).div(await lpToken.totalSupply());

      // Next, the trader removes their liquidity to validate they get back the right number of long/short tokens.
      await lpToken.approve(router.address, MAX_UINT_VAL, { from: trader });

      const traderLpBalance = await lpToken.balanceOf(trader);

      await router.removeLiquidity(
        longToken.address,
        shortToken.address,
        traderLpBalance.toString(),
        "0",
        "0",
        trader,
        MAX_UINT_VAL,
        { from: trader }
      );

      // Trader should get back tokens in the exact ratio that the pair has between long and short tokens. This should be
      // approximately equal to a 100:1 ratio, as this is the rate the pool was seeded at (error introduced by single
      // sided deposit that will make this not exactly 100:1) and should be exactly equal to the ratio from the previous calc.
      // In these calculations we check that the output is within 5000 wei of the expected value.
      assert.equal((await lpToken.balanceOf(trader)).toString(), toWei("0"));

      const longTraderBalance = await longToken.balanceOf(trader);
      const shortTraderBalance = await shortToken.balanceOf(trader);

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
  });
});
