const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract } = hre;
const {
  MAX_UINT_VAL,
  MAX_SAFE_ALLOWANCE,
  ZERO_ADDRESS,
  didContractThrow,
  parseFixed,
  createContractObjectFromJson,
} = require("@uma/common");
const { toWei, toBN, fromWei, padRight, utf8ToHex } = web3.utils;
const { assert } = require("chai");

// Tested Contract
const ReserveCurrencyLiquidator = getContract("ReserveCurrencyLiquidator");

// Uniswap related contracts
const UniswapV2Factory = require("@uniswap/v2-core/build/UniswapV2Factory.json");
const IUniswapV2Pair = require("@uniswap/v2-core/build/IUniswapV2Pair.json");
const UniswapV2Router02 = require("@uniswap/v2-periphery/build/UniswapV2Router02.json");

// Helpers and other contracts
const Token = getContract("ExpandedERC20");
const ExpiringMultiParty = getContract("ExpiringMultiParty");
const Store = getContract("Store");
const Finder = getContract("Finder");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const Timer = getContract("Timer");
const DSProxyFactory = getContract("DSProxyFactory");
const DSProxy = getContract("DSProxy");

// Tested contract
let reserveCurrencyLiquidator;

let reserveToken;
let collateralToken;
let syntheticToken;
let factory;
let router;
let pair;
let pairAddress;
let dsProxy;
let dsProxyFactory;
let financialContract;
let identifierWhitelist;
let timer;
let finder;
let store;
// set the starting pool price at 1000 reserveToken/collateralToken
let startingReservePoolAmount = toBN(toWei("1000")).muln(50);
let startingCollateralPoolAmount = toBN(toWei("1")).muln(50);
let constructorParams;

const priceFeedIdentifier = padRight(utf8ToHex("TEST_IDENTIFIER"), 64);
const unreachableDeadline = 4772084478; // 100 years in the future
const finalFeeAmount = toBN(toWei("0.1"));
const fixedPointAdjustment = toBN(toWei("1"));

// Returns the current spot price of a uniswap pool, scaled to 4 decimal points.
const getPoolSpotPrice = async () => {
  const poolTokenABalance = toBN(await reserveToken.methods.balanceOf(pairAddress).call());
  const poolTokenBBalance = toBN(await collateralToken.methods.balanceOf(pairAddress).call());
  return Number(fromWei(poolTokenABalance.mul(fixedPointAdjustment).div(poolTokenBBalance))).toFixed(4);
};

// For a given number of tokens to liquidate, calculate the expected number of tokens that the DSProxy will likely buy
// to facilitate the swap/mint/liquidate action.
const computeExpectedTokenBuy = async (tokensToLiquidate) => {
  const contractGcr = toBN((await financialContract.methods.pfc().call()).toString())
    .mul(fixedPointAdjustment)
    .div(toBN((await financialContract.methods.totalTokensOutstanding().call()).toString()));
  return tokensToLiquidate.mul(contractGcr).div(fixedPointAdjustment).add(finalFeeAmount);
};

describe("ReserveTokenLiquidator", function () {
  let accounts;
  let deployer;
  let sponsor1;
  let sponsor2;
  let liquidator;

  // Common liquidation sanity checks. repeated in the different unit tests.
  const validateLiquidationOutput = async (liquidations) => {
    assert.equal(liquidations.length, 1);
    assert.equal(liquidations[0].sponsor, sponsor1); // The selected sponsor should be liquidated.
    assert.equal(liquidations[0].liquidator, dsProxy.options.address); // The dSProxy did the liquidation.
    assert.equal(liquidations[0].tokensOutstanding.toString(), toWei("1000")); // The full position should be liquidated.
    assert.equal(liquidations[0].lockedCollateral.toString(), toWei("2")); // The full position's collateral should be locked.
    assert.equal(liquidations[0].liquidatedCollateral.toString(), toWei("2")); // The full position's collateral should be liquidated.
    assert.equal(liquidations[0].disputer, ZERO_ADDRESS); // The liquidation should be undisputed.
    assert.equal(liquidations[0].settlementPrice.toString(), toWei("0")); // The liquidation should not have a price (undisputed)
    assert.equal(liquidations[0].finalFee.toString(), finalFeeAmount.toString()); // The final fee should not match the expected amount
  };

  // Generate common call data for unit tests.
  const buildCallData = (
    reserveTokenAddress = reserveToken.options.address,
    maxSlippage = toWei("0.5"),
    maxTokensToLiquidate = toWei("1000")
  ) => {
    return reserveCurrencyLiquidator.methods
      .swapMintLiquidate(
        router.options.address, // uniswapRouter
        financialContract.options.address, // financialContract
        reserveTokenAddress, // reserveCurrency
        sponsor1, // liquidatedSponsor
        { rawValue: 0 }, // minCollateralPerTokenLiquidated
        { rawValue: MAX_SAFE_ALLOWANCE }, // maxCollateralPerTokenLiquidated. This number need to be >= the token price.
        { rawValue: maxTokensToLiquidate }, // maxTokensToLiquidate. This is how many tokens the positions has (liquidated debt).
        maxSlippage, // maxSlippage set to 50% to not worry about slippage in inital tests.
        unreachableDeadline
      )
      .encodeABI();
  };

  before(async () => {
    accounts = await web3.eth.getAccounts();
    [deployer, sponsor1, sponsor2, liquidator] = accounts;
    await runDefaultFixture(hre);
    dsProxyFactory = await DSProxyFactory.new().send({ from: accounts[0] });

    finder = await Finder.deployed();
    store = await Store.deployed();
    timer = await Timer.deployed();

    // Create identifier whitelist and register the price tracking ticker with it.
    identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.methods.addSupportedIdentifier(priceFeedIdentifier).send({ from: deployer });
  });

  beforeEach(async () => {
    // deploy the ReserveTokenLiquidator
    reserveCurrencyLiquidator = await ReserveCurrencyLiquidator.new().send({ from: accounts[0] });

    // deploy tokens
    reserveToken = await Token.new("reserveToken", "DAI", 18).send({ from: accounts[0] });
    collateralToken = await Token.new("collateralToken", "WETH", 18).send({ from: accounts[0] });
    syntheticToken = await Token.new("Test Synthetic Token", "SYNTH", 18).send({ from: accounts[0] });

    await store.methods
      .setFinalFee(collateralToken.options.address, { rawValue: finalFeeAmount.toString() })
      .send({ from: accounts[0] });

    await reserveToken.methods.addMember(1, deployer).send({ from: deployer });
    await collateralToken.methods.addMember(1, deployer).send({ from: deployer });
    await syntheticToken.methods.addMember(1, deployer).send({ from: deployer });

    // Give the sponsors collateral Token to create positions.
    await collateralToken.methods.mint(sponsor1, toWei("100000000000000")).send({ from: accounts[0] });
    await collateralToken.methods.mint(sponsor2, toWei("100000000000000")).send({ from: accounts[0] });

    // deploy Uniswap V2 Factory & router.
    factory = (await createContractObjectFromJson(UniswapV2Factory, web3).new(deployer, { from: deployer })).contract;
    router = (
      await createContractObjectFromJson(UniswapV2Router02, web3).new(
        factory.options.address,
        collateralToken.options.address,
        { from: deployer }
      )
    ).contract;

    // initialize the pair
    await factory.methods
      .createPair(reserveToken.options.address, collateralToken.options.address)
      .send({ from: deployer });
    pairAddress = await factory.methods.getPair(reserveToken.options.address, collateralToken.options.address).call();
    pair = (await createContractObjectFromJson(IUniswapV2Pair, web3).at(pairAddress)).contract;

    await reserveToken.methods.mint(pairAddress, startingReservePoolAmount).send({ from: accounts[0] });
    await collateralToken.methods.mint(pairAddress, startingCollateralPoolAmount).send({ from: accounts[0] });
    await pair.methods.sync().send({ from: deployer });
    assert.equal(await getPoolSpotPrice(), "1000.0000"); // price should be exactly 1000 reserveToken/collateralToken.

    // Create the EMP to mint positions.
    constructorParams = {
      expirationTimestamp: unreachableDeadline,
      withdrawalLiveness: "100",
      collateralAddress: collateralToken.options.address,
      tokenAddress: syntheticToken.options.address,
      finderAddress: finder.options.address,
      priceFeedIdentifier: priceFeedIdentifier,
      liquidationLiveness: "100",
      collateralRequirement: { rawValue: toWei("1.5") },
      disputeBondPercentage: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPercentage: { rawValue: toWei("0.1") },
      disputerDisputeRewardPercentage: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") },
      timerAddress: timer.options.address,
      financialProductLibraryAddress: ZERO_ADDRESS,
    };

    await identifierWhitelist.methods.addSupportedIdentifier(priceFeedIdentifier).send({ from: deployer });

    financialContract = await ExpiringMultiParty.new(constructorParams).send({ from: accounts[0] });
    await syntheticToken.methods.addMinter(financialContract.options.address).send({ from: accounts[0] });
    await syntheticToken.methods.addBurner(financialContract.options.address).send({ from: accounts[0] });

    // Create two initial positions from the two sponsors. Say the test synthetic token is a stable coin, collateralized
    // in WETH. To start with, let's assume the collateral price is 1000 USD. Sponsor 1 creates an initial position of
    // 1000 synthetics collateralized by 2 WETH. This sets their CR to 2 and the GCR to 2.
    await collateralToken.methods.approve(financialContract.options.address, MAX_UINT_VAL).send({ from: sponsor1 });
    await await financialContract.methods
      .create({ rawValue: toWei("2") }, { rawValue: toWei("1000") })
      .send({ from: sponsor1 });

    // Next, the second sponsor creates 1000 tokens, collateralized by 3 WETH. This sets the GCR to (5 * 1000)/(2 * 1000)=2.5
    await collateralToken.methods.approve(financialContract.options.address, MAX_UINT_VAL).send({ from: sponsor2 });
    await await financialContract.methods
      .create({ rawValue: toWei("3") }, { rawValue: toWei("1000") })
      .send({ from: sponsor2 });

    // Finally, create a DSProxy for the liquidator. This will be used to send the atomic liquidation transactions.
    await dsProxyFactory.methods.build().send({ from: liquidator });
    dsProxy = await DSProxy.at((await dsProxyFactory.getPastEvents("Created"))[0].returnValues.proxy);
  });

  it("can correctly swap,mint,liquidate", async function () {
    // Send tokens from liquidator to DSProxy. This would be done by seeding the common DSProxy shared between multiple bots.
    await reserveToken.methods.mint(dsProxy.options.address, toWei("10000")).send({ from: accounts[0] });

    // The DSProxy should not have any synthetics or collateral before the liquidation.
    assert.equal(await collateralToken.methods.balanceOf(dsProxy.options.address).call(), "0");
    assert.equal(await syntheticToken.methods.balanceOf(dsProxy.options.address).call(), "0");

    const startingUniswapPrice = await getPoolSpotPrice();

    // There should be no liquidations before the transaction call.
    assert.equal((await financialContract.methods.getLiquidations(sponsor1).call()).length, 0);

    // Build the transaction call data.
    const callData = buildCallData();

    await dsProxy.methods["execute(address,bytes)"](reserveCurrencyLiquidator.options.address, callData).send({
      from: liquidator,
    });

    // The DSProxy should not have any synthetics or collateral after the liquidation as everything was used.
    assert.equal(await collateralToken.methods.balanceOf(dsProxy.options.address).call(), "0");
    assert.equal(await syntheticToken.methods.balanceOf(dsProxy.options.address).call(), "0");

    // There should be one liquidation after the call and the properties on the liquidation should match what is expected.
    const liquidations = await financialContract.methods.getLiquidations(sponsor1).call();
    await validateLiquidationOutput(liquidations);

    // The price in the uniswap pool should be greater than what it started at as we traded reserve for collateral.
    assert.equal(Number((await getPoolSpotPrice()) > Number(startingUniswapPrice)), 1);

    // In this test the DSProxy should have swapped, minted and liquidated. We should expect to see exactly these events.
    assert.equal((await financialContract.getPastEvents("PositionCreated")).length, 1);
    assert.equal((await pair.getPastEvents("Swap")).length, 1);
    assert.equal((await financialContract.getPastEvents("LiquidationCreated")).length, 1);
  });
  it("should use existing token and synthetic balances", async function () {
    // If the DSProxy already has any synthetics or collateral, the contract should use them all within the liquidation.
    await reserveToken.methods.mint(dsProxy.options.address, toWei("10000")).send({ from: accounts[0] }); // mint some reserve tokens.
    await collateralToken.methods.mint(dsProxy.options.address, toWei("0.5")).send({ from: accounts[0] }); // send half of 1 eth to the DSProxy
    await syntheticToken.methods.mint(dsProxy.options.address, toWei("200")).send({ from: accounts[0] }); // send 200 synthetics to the DSProxy

    // Build the transaction call data.
    const callData = buildCallData();

    await dsProxy.methods["execute(address,bytes)"](reserveCurrencyLiquidator.options.address, callData).send({
      from: liquidator,
    });

    // The DSProxy should not have any synthetics or collateral after the liquidation as everything was used, including
    // the full amount of currency that was in the proxy beforehand.
    assert.equal(await collateralToken.methods.balanceOf(dsProxy.options.address).call(), "0");
    assert.equal(await syntheticToken.methods.balanceOf(dsProxy.options.address).call(), "0");

    // There should be one liquidation after the call and the properties on the liquidation should match what is expected.
    const liquidations = await financialContract.methods.getLiquidations(sponsor1).call();
    await validateLiquidationOutput(liquidations);

    // In this test the DSProxy should have swapped, minted and liquidated. We should expect to see exactly these events.
    assert.equal((await financialContract.getPastEvents("PositionCreated")).length, 1);
    assert.equal((await pair.getPastEvents("Swap")).length, 1);
    assert.equal((await financialContract.getPastEvents("LiquidationCreated")).length, 1);
  });
  it("should correctly handle synthetic balance larger than liquidated position", async function () {
    // If the DSProxy's synthetic balance is larger than that to be liquidated, then it does not need to preform any
    // extra buys OR mints. Send the synthetic reserve token, of which it should use only enough to buy the final fee.
    // Send synthetics larger than the position liquidated.
    await reserveToken.methods.mint(dsProxy.options.address, toWei("10000")).send({ from: accounts[0] }); // mint some reserve tokens.
    await syntheticToken.methods.mint(dsProxy.options.address, toWei("2000")).send({ from: accounts[0] }); // send 200 synthetics to the DSProxy

    // Build the transaction call data.
    const callData = buildCallData();

    await dsProxy.methods["execute(address,bytes)"](reserveCurrencyLiquidator.options.address, callData).send({
      from: liquidator,
    });

    // The DSProxy should not have any collateral after the liquidation as everything was used. The synthetic balance
    // should be the starting balance minus the amount liquidated as 2000-1000=1000.
    assert.equal((await collateralToken.methods.balanceOf(dsProxy.options.address).call()).toString(), "0");
    assert.equal((await syntheticToken.methods.balanceOf(dsProxy.options.address).call()).toString(), toWei("1000"));

    // There should be one liquidation after the call and the properties on the liquidation should match what is expected.
    const liquidations = await financialContract.methods.getLiquidations(sponsor1).call();
    await validateLiquidationOutput(liquidations);

    // In this test the DSProxy did not need to mint. However, it did need to swap to pay the final fee.
    assert.equal((await financialContract.getPastEvents("PositionCreated")).length, 0);
    assert.equal((await pair.getPastEvents("Swap")).length, 1);
    assert.equal((await financialContract.getPastEvents("LiquidationCreated")).length, 1);
  });
  it("should correctly handle collateral balance larger than required for synthetic position mint", async function () {
    // If the DSProxy's balance collateral balance is larger than then that to be minted, then it does not need to preform
    // any extra buys. However, the DSProxy still needs to mint synthetics to preform the liquidation. Send the synthetic
    // reserve token, of which it should use none. Send collateral larger than needed to mint positions.
    await reserveToken.methods.mint(dsProxy.options.address, toWei("10000")).send({ from: accounts[0] }); // mint some reserve tokens.
    await collateralToken.methods.mint(dsProxy.options.address, toWei("10")).send({ from: accounts[0] }); // send 10 collateral to the DSProxy.

    // Build the transaction call data.
    const callData = buildCallData();

    await dsProxy.methods["execute(address,bytes)"](reserveCurrencyLiquidator.options.address, callData).send({
      from: liquidator,
    });

    // The DSProxy should have used some of it's collateral and no additional reserves when executing the liquidation.
    // The collateral remaining should be the starting amount minus that used in the mint. The GCR is 5/2000= 0.0025.
    // to liquidate the position, we require 1000 Synthetics. Therefore used collateral should be 0.0025 * 1000 = 2.5.
    // Added to this, the liquidator spent 0.1 ETH on final fee. the net balance should be 10 - 2.5 - 0.1 = 7.4.
    assert.equal((await collateralToken.methods.balanceOf(dsProxy.options.address).call()).toString(), toWei("7.4"));
    assert.equal((await syntheticToken.methods.balanceOf(dsProxy.options.address).call()).toString(), toWei("0"));
    assert.equal((await reserveToken.methods.balanceOf(dsProxy.options.address).call()).toString(), toWei("10000"));

    // There should be one liquidation after the call and the properties on the liquidation should match what is expected.
    const liquidations = await financialContract.methods.getLiquidations(sponsor1).call();
    await validateLiquidationOutput(liquidations);

    // In this test the DSProxy had enough collateral so did not need to swap. However, it needed to mint. Events should match.
    assert.equal((await financialContract.getPastEvents("PositionCreated")).length, 1);
    assert.equal((await pair.getPastEvents("Swap")).length, 0);
    assert.equal((await financialContract.getPastEvents("LiquidationCreated")).length, 1);
  });
  it("can correctly deal with collateral and reserve being the same token", async function () {
    // Send tokens from liquidator to DSProxy. This would be done by seeding the common DSProxy shared between multiple bots.
    await collateralToken.methods.mint(dsProxy.options.address, toWei("10000")).send({ from: accounts[0] });

    // The DSProxy should not have any synthetics or collateral before the liquidation.
    assert.equal((await collateralToken.methods.balanceOf(dsProxy.options.address).call()).toString(), toWei("10000"));
    assert.equal(await reserveToken.methods.balanceOf(dsProxy.options.address).call(), "0");
    assert.equal(await syntheticToken.methods.balanceOf(dsProxy.options.address).call(), "0");

    const startingUniswapPrice = await getPoolSpotPrice();

    // There should be no liquidations before the transaction call.
    assert.equal((await financialContract.methods.getLiquidations(sponsor1).call()).length, 0);

    // Build the transaction call data. This differs from the previous tests in that it uses the collateral as reserve token.
    const callData = buildCallData(collateralToken.options.address);

    await dsProxy.methods["execute(address,bytes)"](reserveCurrencyLiquidator.options.address, callData).send({
      from: liquidator,
    });

    // The DSProxy should not have any synthetics or collateral after the liquidation as everything was used.
    assert.equal(await syntheticToken.methods.balanceOf(dsProxy.options.address).call(), "0");

    // There should be one liquidation after the call and the properties on the liquidation should match what is expected.
    const liquidations = await financialContract.methods.getLiquidations(sponsor1).call();
    await validateLiquidationOutput(liquidations);

    // The price in the uniswap pool should not have moved at all as no trade.
    assert.equal(await getPoolSpotPrice(), startingUniswapPrice);

    // In this test the DSProxy should not swapped, but should have minted and liquidated. We should expect to see exactly these events.
    assert.equal((await financialContract.getPastEvents("PositionCreated")).length, 1);
    assert.equal((await pair.getPastEvents("Swap")).length, 0);
    assert.equal((await financialContract.getPastEvents("LiquidationCreated")).length, 1);
  });
  it("can correctly deal with collateral and reserving shortfall for liquidation size", async function () {
    // In the even that the DSProxy does not have enough collateral or reserves it should liquidate as much as posable, {     // using all ammunition it can. Send tokens from liquidator to DSProxy.Send less than the amount needed for the liquidation.
    await collateralToken.methods.mint(dsProxy.options.address, toWei("1")).send({ from: accounts[0] });

    // The DSProxy should not have any synthetics or collateral before the liquidation.
    assert.equal((await collateralToken.methods.balanceOf(dsProxy.options.address).call()).toString(), toWei("1"));
    assert.equal(await reserveToken.methods.balanceOf(dsProxy.options.address).call(), "0");
    assert.equal(await syntheticToken.methods.balanceOf(dsProxy.options.address).call(), "0");

    const startingUniswapPrice = await getPoolSpotPrice();

    // There should be no liquidations before the transaction call.
    assert.equal((await financialContract.methods.getLiquidations(sponsor1).call()).length, 0);

    // Build the transaction call data. This differs from the previous tests in that it uses the collateral as reserve token.
    // Also, note that the maxTokensToLiquidate is more than the bot could do with just 1 wei of collateral.
    let callData = buildCallData(collateralToken.options.address, toWei("0.5")); // maxSlippage above any achievable slippage given the pool sizes (50%)

    await dsProxy.methods["execute(address,bytes)"](reserveCurrencyLiquidator.options.address, callData).send({
      from: liquidator,
    });

    // The DSProxy should not have any synthetics or collateral after the liquidation as everything was used.
    assert.equal(await syntheticToken.methods.balanceOf(dsProxy.options.address).call(), "0");
    assert.equal(await reserveToken.methods.balanceOf(dsProxy.options.address).call(), "0");
    assert.equal(await syntheticToken.methods.balanceOf(dsProxy.options.address).call(), "0");

    // There should be one liquidation after the call and the properties on the liquidation should match what is expected.
    const liquidations = await financialContract.methods.getLiquidations(sponsor1).call();

    // Cant use validateLiquidationOutput as this is a different sized liquidation.
    assert.equal(liquidations.length, 1);
    assert.equal(liquidations[0].sponsor, sponsor1); // The selected sponsor should be liquidated.
    assert.equal(liquidations[0].liquidator, dsProxy.options.address); // The dSProxy did the liquidation.
    assert.equal(liquidations[0].disputer, ZERO_ADDRESS); // The liquidation should be undisputed.
    assert.equal(liquidations[0].settlementPrice.toString(), toWei("0")); // The liquidation should not have a price (undisputed)
    assert.equal(liquidations[0].finalFee.toString(), finalFeeAmount.toString()); // The final fee should not match the expected amount

    // The price in the uniswap pool should not have moved at all as no trade.
    assert.equal(await getPoolSpotPrice(), startingUniswapPrice);

    // In this test the DSProxy should not swapped, but should have minted and liquidated. We should expect to see exactly these events.
    assert.equal((await financialContract.getPastEvents("PositionCreated")).length, 1);
    assert.equal((await pair.getPastEvents("Swap")).length, 0);
    assert.equal((await financialContract.getPastEvents("LiquidationCreated")).length, 1);
  });
  it("correctly respects max slippage tolerance", async function () {
    await reserveToken.methods.mint(dsProxy.options.address, toWei("10000")).send({ from: accounts[0] });

    // To test the slippage tolerances of the smart contract we can compute how much the price will move for a given trade
    // and then ensure that the contract will revert if the slippage is large than the tolerance. The position size being
    // liquidated is 1000 units of synthetics. We can compute how much the bot will need to buy to mint this size by
    // calculating the amount of collateral to mint at the GCR + the final fee. From the size of the position of 1000
    // synthetics and a GCR of 2.5 the bot will need 2.5 units of collateral to mint + 0.1 for the final fee, totalling 2.6.
    // Based on the pool size of 50000 reserve to 50 collateral a purchase of 2.6 collateral with reserve will require a
    // reserve input of 2750.86.
    const expectedTokenBuy = await computeExpectedTokenBuy(toBN(toWei("1000"))); // how much collateral to liquidate the full 1000 unit position
    const amountsIn = await router.methods
      .getAmountsIn(expectedTokenBuy, [reserveToken.options.address, collateralToken.options.address])
      .call();

    // compute the resultant price by considering how much the pools will mode due to the amounts in/out. This is
    // (50000+2750.86)/(50-2.6)=1112.8875
    const numerator = startingReservePoolAmount.add(toBN(amountsIn[0]));
    const denominator = startingCollateralPoolAmount.sub(toBN(amountsIn[1]));
    const expectedResultantPrice = numerator.mul(fixedPointAdjustment).div(denominator);

    // The expected slippage is the resultant price (post trade) divided by the original price, minus 1. This is
    // 1112.8875/1000-1=0.1128875 (i.e 11.28875%). Trying to execute a trade with a slippage tolerance of 11 should fail
    // but 12 should pass.
    const expectedTradeSlippage = expectedResultantPrice
      .mul(fixedPointAdjustment)
      .div(toBN(toWei(await getPoolSpotPrice())))
      .sub(fixedPointAdjustment);
    assert.equal(Number(fromWei(expectedTradeSlippage)).toFixed(7), "0.1128875"); // check the expected slip matches our calculations

    // Build call data with a slippage tolerance of 11%. this is below the expected slippage of 11.28. Should revert.
    let callData = buildCallData(reserveToken.options.address, toWei("0.11"));

    assert(
      await didContractThrow(
        dsProxy.methods["execute(address,bytes)"](reserveCurrencyLiquidator.options.address, callData).send({
          from: liquidator,
        })
      )
    );

    // Build call data with a slippage tolerance of 12%, right above the expected slippage of 12.28%. This should not revert.
    callData = buildCallData(reserveToken.options.address, toWei("0.12"));

    await dsProxy.methods["execute(address,bytes)"](reserveCurrencyLiquidator.options.address, callData).send({
      from: liquidator,
    });

    // There should be one liquidation after the call and the properties on the liquidation should match what is expected.
    const liquidations = await financialContract.methods.getLiquidations(sponsor1).call();
    await validateLiquidationOutput(liquidations);

    // To validate some of our assumptions the expected price from before should equal the resultant uniswap price.
    assert.equal(await getPoolSpotPrice(), Number(fromWei(expectedResultantPrice)).toFixed(4));
  });
  it("correctly swaps against very small denominated pools", async function () {
    // Some pools have wacky sizing, such as SLP-DIGG-WBTC which has a total supply of 0.000000071317329372. The underlying
    // tokens in these pools have 8 and 9 decimals for WBTC and DIGG respectively,  but the LP tokens have 18, leading to
    // the strange sizing.To ensure slippage tolerances are correctly respected on this kind of pool we can mimic the exact SLP setup.

    // Create the reserve, collateral and synthetic tokens afresh using new decimals. Reserve token in this case is wBTC
    // and collateral token is DIGG.
    reserveToken = await Token.new("reserveToken", "wBTC", 8).send({ from: accounts[0] });
    // Synthetic and collateral precision must match.
    collateralToken = await Token.new("collateralToken", "DIGG", 9).send({ from: accounts[0] });
    syntheticToken = await Token.new("Test Synthetic Token", "SYNTH", 9).send({ from: accounts[0] });

    await reserveToken.methods.addMember(1, deployer).send({ from: deployer });
    await collateralToken.methods.addMember(1, deployer).send({ from: deployer });
    await syntheticToken.methods.addMember(1, deployer).send({ from: deployer });

    // Create some unit conversion utils to help with the testing.
    const Convert = (decimals) => (number) => (number ? parseFixed(number.toString(), decimals).toString() : number);
    const convertReserve = Convert(8);
    const convertCollateral = Convert(9);
    const convertSynthetic = Convert(9);

    // create a new router and pair to re-initalize from fresh.
    factory = (await createContractObjectFromJson(UniswapV2Factory, web3).new(deployer, { from: deployer })).contract;
    router = (
      await createContractObjectFromJson(UniswapV2Router02, web3).new(
        factory.options.address,
        collateralToken.options.address
      )
    ).contract;
    await factory.methods
      .createPair(reserveToken.options.address, collateralToken.options.address)
      .send({ from: deployer });
    pairAddress = await factory.methods.getPair(reserveToken.options.address, collateralToken.options.address).call();
    pair = (await createContractObjectFromJson(IUniswapV2Pair, web3).at(pairAddress)).contract;

    // Add in the exact reserves as seen on the live pools. At these reserve ratios the starting price is 0.0797.
    await reserveToken.methods.mint(pairAddress, "10881694425").send({ from: accounts[0] });
    await collateralToken.methods.mint(pairAddress, "136567052391").send({ from: accounts[0] });
    await pair.methods.sync().send({ from: deployer });

    // Create the EMP to mint positions.
    constructorParams = {
      ...constructorParams,
      collateralAddress: collateralToken.options.address,
      tokenAddress: syntheticToken.options.address,
      minSponsorTokens: { rawValue: convertSynthetic("100") },
    };
    await identifierWhitelist.methods.addSupportedIdentifier(priceFeedIdentifier).send({ from: deployer });
    financialContract = await ExpiringMultiParty.new(constructorParams).send({ from: accounts[0] });
    await syntheticToken.methods.addMinter(financialContract.options.address).send({ from: accounts[0] });
    await syntheticToken.methods.addBurner(financialContract.options.address).send({ from: accounts[0] });

    // Create one sponsor that we will attempt to liquidate and validate slippage.
    await collateralToken.methods.mint(sponsor1, toWei("100000000000000")).send({ from: accounts[0] });
    await collateralToken.methods.approve(financialContract.options.address, MAX_UINT_VAL).send({ from: sponsor1 });
    await await financialContract.methods
      .create({ rawValue: convertCollateral("20") }, { rawValue: convertSynthetic("10000") })
      .send({ from: sponsor1 });

    // mint some reserve to the dsproxy.
    await reserveToken.methods.mint(dsProxy.options.address, convertReserve("1000000")).send({ from: accounts[0] }); // mint some reserve tokens.

    // We know the exact number of tokens in the pool and the number of tokens required to mint at the GCR. The GCR is
    // 2e9 / 1000e9=0.0002. To liquidate 1000 units of debt, while minting at the GCR the dsProxy will also need 2e9 units
    // of collateral. To find the exchange rate we can use the getAmountsIn method, as before. to compute the expected output
    // we can use numerator=reserveIn*amountOut*1000; denominator=(reserveOut-amountOut)*997; amountIn=numerator/denominator
    // numerator=10881694425*20e9*1000; denominator=(136567052391-20e9)*997; amountIn = 1872645403. From this, the resultant
    // price is expected to be (10881694425+1872645403)/(136567052391-20e9)=0.1094. From this, we can see the expected slippage
    // is 0.1094/0.0797-1 ≈ 0.37. A slippage tolerance of 30% should revert but and a tolerance of 40% should not.

    // maxSlippage set to 34% is below the expected slippage of 37% for this liquidation. should revert.
    let callData = buildCallData(reserveToken.options.address, toWei("0.34"), convertSynthetic("10000"));

    assert(
      await didContractThrow(
        dsProxy.methods["execute(address,bytes)"](reserveCurrencyLiquidator.options.address, callData).send({
          from: liquidator,
        })
      )
    );

    // maxSlippage set to 40% is above the expected slippage of 37% for this liquidation. should not revert.
    callData = buildCallData(reserveToken.options.address, toWei("0.40"), convertSynthetic("10000"));

    await dsProxy.methods["execute(address,bytes)"](reserveCurrencyLiquidator.options.address, callData).send({
      from: liquidator,
    });

    // There should be one liquidation after the call and the properties on the liquidation should match what is expected.
    const liquidations = await financialContract.methods.getLiquidations(sponsor1).call();
    assert.equal(liquidations.length, 1);
    assert.equal(liquidations[0].sponsor, sponsor1); // The selected sponsor should be liquidated.
    assert.equal(liquidations[0].liquidator, dsProxy.options.address); // The dSProxy did the liquidation.

    // Validate the calculations we had at the top of the unit test by ensuring the post trade spot price matches our expectation.
    assert.equal(await getPoolSpotPrice(), "0.1094");
  });
  it("correctly swaps against pools with large differences in token decimals", async function () {
    // Some pools have have wide ranges in token decimals. For example USDC has 6 decimals while WETH has 18. Validate
    // that slippage is correctly accounted for when buying lower decimal reserve currencies in this way.

    reserveToken = await Token.new("reserveToken", "WETH", 18).send({ from: accounts[0] });
    // Synthetic and collateral precision must match.
    collateralToken = await Token.new("collateralToken", "USDC", 6).send({ from: accounts[0] });
    syntheticToken = await Token.new("Test Synthetic Token", "SYNTH", 6).send({ from: accounts[0] });

    await reserveToken.methods.addMember(1, deployer).send({ from: deployer });
    await collateralToken.methods.addMember(1, deployer).send({ from: deployer });
    await syntheticToken.methods.addMember(1, deployer).send({ from: deployer });

    // Create some unit conversion utils to help with the testing.
    const Convert = (decimals) => (number) => (number ? parseFixed(number.toString(), decimals).toString() : number);
    const convertCollateral = Convert(6);
    const convertSynthetic = Convert(6);

    // create a new router and pair to re-initalize from fresh.
    factory = (await createContractObjectFromJson(UniswapV2Factory, web3).new(deployer, { from: deployer })).contract;
    router = (
      await createContractObjectFromJson(UniswapV2Router02, web3).new(
        factory.options.address,
        collateralToken.options.address
      )
    ).contract;
    await factory.methods
      .createPair(reserveToken.options.address, collateralToken.options.address)
      .send({ from: deployer });
    pairAddress = await factory.methods.getPair(reserveToken.options.address, collateralToken.options.address).call();
    pair = (await createContractObjectFromJson(IUniswapV2Pair, web3).at(pairAddress)).contract;

    // Add liquidity to the pool such that the price is 1000 ETH/USDC.
    await reserveToken.methods.mint(pairAddress, toWei("1000")).send({ from: accounts[0] }); // 1000 Weth.
    await collateralToken.methods.mint(pairAddress, convertCollateral("1000000")).send({ from: accounts[0] }); // 1000x1000 USDC to make a price of 1000 ETH/USD
    await pair.methods.sync().send({ from: deployer });

    // Create the EMP to mint positions.
    constructorParams = {
      ...constructorParams,
      collateralAddress: collateralToken.options.address,
      tokenAddress: syntheticToken.options.address,
      minSponsorTokens: { rawValue: convertSynthetic("100") },
    };
    await identifierWhitelist.methods.addSupportedIdentifier(priceFeedIdentifier).send({ from: deployer });
    financialContract = await ExpiringMultiParty.new(constructorParams).send({ from: accounts[0] });
    await syntheticToken.methods.addMinter(financialContract.options.address).send({ from: accounts[0] });
    await syntheticToken.methods.addBurner(financialContract.options.address).send({ from: accounts[0] });

    // Create one sponsor that we will attempt to liquidate and validate slippage.
    await collateralToken.methods.mint(sponsor1, toWei("100000000000000")).send({ from: accounts[0] });
    await collateralToken.methods.approve(financialContract.options.address, MAX_UINT_VAL).send({ from: sponsor1 });
    await await financialContract.methods
      .create(
        { rawValue: convertCollateral("20000") }, // put in 2000 USDC
        { rawValue: convertSynthetic("10000") } // mint 1000 synthetics. CR at 2.
      )
      .send({ from: sponsor1 });

    // mint some reserve to the dsproxy.
    await reserveToken.methods.mint(dsProxy.options.address, toWei("100000")).send({ from: accounts[0] }); // mint some reserve tokens.

    // With reserves of 1000e18 weth and 1000000e6 USDC, the starting price is 1000 ETH/USD. To liquidate 10000 tokens
    // we will need 20000 units of collateral. The expected amount in for a given buy of 20000e6 price after this trade
    // will be 1000e18 * 20000e6 * 1000 / ((1000000e6 - 20000e6) * 997)=2.046957e18. Considering this, the dex price will be
    // (1000e18+20.469e18)/(1000000e6-20000e6)=1041295481.61. This is then divided by 1e6 to remove the decimals from the price
    // yielding 1041.2. Therefore, the price slippage is 4.12% to preform this liquidation, from the starting price of 1000.

    // maxSlippage set to 4% is below the expected slippage of 4.12% for this liquidation. should revert.
    let callData = buildCallData(reserveToken.options.address, toWei("0.04"), convertSynthetic("10000"));

    assert(
      await didContractThrow(
        dsProxy.methods["execute(address,bytes)"](reserveCurrencyLiquidator.options.address, callData).send({
          from: liquidator,
        })
      )
    );

    // maxSlippage set to 5% is above the expected slippage of 4.12% for this liquidation. should not revert.
    callData = buildCallData(reserveToken.options.address, toWei("0.05"), convertSynthetic("10000"));

    await dsProxy.methods["execute(address,bytes)"](reserveCurrencyLiquidator.options.address, callData).send({
      from: liquidator,
    });

    // There should be one liquidation after the call and the properties on the liquidation should match what is expected.
    const liquidations = await financialContract.methods.getLiquidations(sponsor1).call();
    assert.equal(liquidations.length, 1);
    assert.equal(liquidations[0].sponsor, sponsor1); // The selected sponsor should be liquidated.
    assert.equal(liquidations[0].liquidator, dsProxy.options.address); // The dSProxy did the liquidation.

    // Validate the calculations we had at the top of the unit test by ensuring the post trade spot price matches our expectation.
    assert.equal(await getPoolSpotPrice(), "1041295481.6135");
  });
});
