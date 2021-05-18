const { MAX_UINT_VAL, MAX_SAFE_ALLOWANCE, ZERO_ADDRESS } = require("@uma/common");
const { toWei, toBN, fromWei, padRight, utf8ToHex } = web3.utils;
const { getTruffleContract } = require("@uma/core");
const truffleContract = require("@truffle/contract");
const { assert } = require("chai");

// Tested Contract
const ReserveCurrencyLiquidator = getTruffleContract("ReserveCurrencyLiquidator", web3);

// Uniswap related contracts
const UniswapV2Factory = require("@uniswap/v2-core/build/UniswapV2Factory.json");
const IUniswapV2Pair = require("@uniswap/v2-core/build/IUniswapV2Pair.json");
const UniswapV2Router02 = require("@uniswap/v2-periphery/build/UniswapV2Router02.json");

// Helpers and other contracts
const Token = getTruffleContract("ExpandedERC20", web3);
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const Store = artifacts.require("Store");
const Finder = artifacts.require("Finder");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const Timer = artifacts.require("Timer");
const DSProxyFactory = getTruffleContract("DSProxyFactory", web3);
const DSProxy = getTruffleContract("DSProxy", web3);

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

const priceFeedIdentifier = padRight(utf8ToHex("TEST_IDENTIFIER"), 64);
const unreachableDeadline = 4772084478; // 100 years in the future
const finalFeeAmount = toBN(toWei("0.1"));

// Returns the current spot price of a uniswap pool, scaled to 4 decimal points.
const getPoolSpotPrice = async () => {
  const poolTokenABallance = await reserveToken.balanceOf(pairAddress);
  const poolTokenBBallance = await collateralToken.balanceOf(pairAddress);
  return Number(fromWei(poolTokenABallance.mul(toBN(toWei("1"))).div(poolTokenBBallance))).toFixed(4);
};

// Takes in a json object from a compiled contract and returns a truffle contract instance that can be deployed.
const createContractObjectFromJson = (contractJsonObject) => {
  let truffleContractCreator = truffleContract(contractJsonObject);
  truffleContractCreator.setProvider(web3.currentProvider);
  return truffleContractCreator;
};

contract("ReserveTokenLiquidator", function (accounts) {
  const deployer = accounts[0];
  const sponsor1 = accounts[1];
  const sponsor2 = accounts[2];
  const liquidator = accounts[2];

  // Common liquidation sanity checks. repeated in the different unit tests.
  const validateLiquidationOutput = async (liquidations) => {
    assert.equal(liquidations.length, 1);
    assert.equal(liquidations[0].sponsor, sponsor1); // The selected sponsor should be liquidated.
    assert.equal(liquidations[0].liquidator, dsProxy.address); // The dSProxy did the liquidation.
    assert.equal(liquidations[0].tokensOutstanding.toString(), toWei("1000")); // The full position should be liquidated.
    assert.equal(liquidations[0].lockedCollateral.toString(), toWei("2")); // The full position's collateral should be locked.
    assert.equal(liquidations[0].liquidatedCollateral.toString(), toWei("2")); // The full position's collateral should be liquidated.
    assert.equal(liquidations[0].disputer, ZERO_ADDRESS); // The liquidation should be undisputed.
    assert.equal(liquidations[0].settlementPrice.toString(), toWei("0")); // The liquidation should not have a price (undisputed)
    assert.equal(liquidations[0].finalFee.toString(), finalFeeAmount.toString()); // The final fee should not match the expected amount
  };

  // Generate common call data for unit tests.
  const buildCallData = () => {
    return reserveCurrencyLiquidator.contract.methods
      .swapMintLiquidate(
        router.address, // uniswapRouter
        financialContract.address, // financialContract
        reserveToken.address, // reserveCurrency
        sponsor1, // liquidatedSponsor
        { rawValue: MAX_UINT_VAL }, // maxReserverTokenSpent
        { rawValue: 0 }, // minCollateralPerTokenLiquidated
        { rawValue: MAX_SAFE_ALLOWANCE }, // maxCollateralPerTokenLiquidated. This number need to be >= the token price.
        { rawValue: toWei("1000") }, // maxTokensToLiquidate. This is how many tokens the positions has (liquidated debt).
        unreachableDeadline
      )
      .encodeABI();
  };

  before(async () => {
    dsProxyFactory = await DSProxyFactory.new();

    finder = await Finder.deployed();
    store = await Store.deployed();
    timer = await Timer.deployed();

    // Create identifier whitelist and register the price tracking ticker with it.
    identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(priceFeedIdentifier, { from: deployer });
  });
  beforeEach(async () => {
    // deploy the ReserveTokenLiquidator
    reserveCurrencyLiquidator = await ReserveCurrencyLiquidator.new();

    // deploy tokens
    reserveToken = await Token.new("reserveToken", "DAI", 18);
    collateralToken = await Token.new("collateralToken", "WETH", 18);
    syntheticToken = await Token.new("Test Synthetic Token", "SYNTH", 18);

    await store.setFinalFee(collateralToken.address, { rawValue: finalFeeAmount.toString() });

    await reserveToken.addMember(1, deployer, { from: deployer });
    await collateralToken.addMember(1, deployer, { from: deployer });
    await syntheticToken.addMember(1, deployer, { from: deployer });

    // Give the sponsors collateral Token to create positions.
    await collateralToken.mint(sponsor1, toWei("100000000000000"));
    await collateralToken.mint(sponsor2, toWei("100000000000000"));

    // deploy Uniswap V2 Factory & router.
    factory = await createContractObjectFromJson(UniswapV2Factory).new(deployer, { from: deployer });
    router = await createContractObjectFromJson(UniswapV2Router02).new(factory.address, collateralToken.address, {
      from: deployer,
    });

    // initialize the pair
    await factory.createPair(reserveToken.address, collateralToken.address, { from: deployer });
    pairAddress = await factory.getPair(reserveToken.address, collateralToken.address);
    pair = await createContractObjectFromJson(IUniswapV2Pair).at(pairAddress);

    await reserveToken.mint(pairAddress, toBN(toWei("1000")).muln(10000000));
    await collateralToken.mint(pairAddress, toBN(toWei("1")).muln(10000000));
    await pair.sync({ from: deployer });
    assert.equal(await getPoolSpotPrice(), "1000.0000"); // price should be exactly 1000 reserveToken/collateralToken.

    // Create the EMP to mint positions.
    const constructorParams = {
      expirationTimestamp: unreachableDeadline,
      withdrawalLiveness: "100",
      collateralAddress: collateralToken.address,
      tokenAddress: syntheticToken.address,
      finderAddress: finder.address,
      priceFeedIdentifier: priceFeedIdentifier,
      liquidationLiveness: "100",
      collateralRequirement: { rawValue: toWei("1.5") },
      disputeBondPercentage: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPercentage: { rawValue: toWei("0.1") },
      disputerDisputeRewardPercentage: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") },
      timerAddress: timer.address,
      financialProductLibraryAddress: ZERO_ADDRESS,
    };

    await identifierWhitelist.addSupportedIdentifier(priceFeedIdentifier, { from: deployer });

    financialContract = await ExpiringMultiParty.new(constructorParams);
    await syntheticToken.addMinter(financialContract.address);
    await syntheticToken.addBurner(financialContract.address);

    // Create two initial positions from the two sponsors. Say the test synthetic token is a stable coin, collateralized
    // in WETH. To start with, let's assume the collateral price is 1000 USD. Sponsor 1 creates an initial position of
    // 1000 synthetics collateralized by 2 WETH. This sets their CR to 2 and the GCR to 2.
    await collateralToken.approve(financialContract.address, MAX_UINT_VAL, { from: sponsor1 });
    await await financialContract.create({ rawValue: toWei("2") }, { rawValue: toWei("1000") }, { from: sponsor1 });

    // Next, the second sponsor creates 1000 tokens, collateralized by 3 WETH. This sets the GCR to (5 * 1000)/(2 * 1000)=2.5
    await collateralToken.approve(financialContract.address, MAX_UINT_VAL, { from: sponsor2 });
    await await financialContract.create({ rawValue: toWei("3") }, { rawValue: toWei("1000") }, { from: sponsor2 });

    // Finally, create a DSProxy for the liquidator. This will be used to send the atomic liquidation transactions.
    await dsProxyFactory.build({ from: liquidator });
    dsProxy = await DSProxy.at((await dsProxyFactory.getPastEvents("Created"))[0].returnValues.proxy);
  });

  it("can correctly swap,mint,liquidate", async function () {
    // Send tokens from liquidator to DSProxy. This would be done by seeding the common DSProxy shared between multiple bots.
    await reserveToken.mint(dsProxy.address, toWei("10000"));

    // The DSProxy should not have any synthetics or collateral before the liquidation.
    assert.equal(await collateralToken.balanceOf(dsProxy.address), "0");
    assert.equal(await syntheticToken.balanceOf(dsProxy.address), "0");

    const startingUniswapPrice = await getPoolSpotPrice();

    // There should be no liquidations before the transaction call.
    assert.equal((await financialContract.getLiquidations(sponsor1)).length, 0);

    // Build the transaction call data.
    const callData = buildCallData();

    await dsProxy.contract.methods["execute(address,bytes)"](reserveCurrencyLiquidator.address, callData).send({
      from: liquidator,
    });

    // The DSProxy should not have any synthetics or collateral after the liquidation as everything was used.
    assert.equal(await collateralToken.balanceOf(dsProxy.address), "0");
    assert.equal(await syntheticToken.balanceOf(dsProxy.address), "0");

    // There should be one liquidation after the call and the properties on the liquidation should match what is expected.
    const liquidations = await financialContract.getLiquidations(sponsor1);
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
    await reserveToken.mint(dsProxy.address, toWei("10000")); // mint some reserve tokens.
    await collateralToken.mint(dsProxy.address, toWei("0.5")); // send half of 1 eth to the DSProxy
    await syntheticToken.mint(dsProxy.address, toWei("200")); // send 200 synthetics to the DSProxy

    // Build the transaction call data.
    const callData = buildCallData();

    await dsProxy.contract.methods["execute(address,bytes)"](reserveCurrencyLiquidator.address, callData).send({
      from: liquidator,
    });

    // The DSProxy should not have any synthetics or collateral after the liquidation as everything was used, including
    // the full amount of currency that was in the proxy beforehand.
    assert.equal(await collateralToken.balanceOf(dsProxy.address), "0");
    assert.equal(await syntheticToken.balanceOf(dsProxy.address), "0");

    // There should be one liquidation after the call and the properties on the liquidation should match what is expected.
    const liquidations = await financialContract.getLiquidations(sponsor1);
    await validateLiquidationOutput(liquidations);

    // In this test the DSProxy should have swapped, minted and liquidated. We should expect to see exactly these events.
    assert.equal((await financialContract.getPastEvents("PositionCreated")).length, 1);
    assert.equal((await pair.getPastEvents("Swap")).length, 1);
    assert.equal((await financialContract.getPastEvents("LiquidationCreated")).length, 1);
  });
  it("should correctly handel synthetic balance larger than liquidated position", async function () {
    // If the DSProxy's synthetic balance is larger than that to be liquidated, then it does not need to preform any
    // extra buys OR mints. Send the synthetic reserve token, of which it should use only enough to buy the final fee.
    // Send synthetics larger than the position liquidated.
    await reserveToken.mint(dsProxy.address, toWei("10000")); // mint some reserve tokens.
    await syntheticToken.mint(dsProxy.address, toWei("2000")); // send 200 synthetics to the DSProxy

    // Build the transaction call data.
    const callData = buildCallData();

    await dsProxy.contract.methods["execute(address,bytes)"](reserveCurrencyLiquidator.address, callData).send({
      from: liquidator,
    });

    // The DSProxy should not have any collateral after the liquidation as everything was used. The synthetic ballance
    // should be the starting balance minus the amount liquidated as 2000-1000=1000.
    assert.equal((await collateralToken.balanceOf(dsProxy.address)).toString(), "0");
    assert.equal((await syntheticToken.balanceOf(dsProxy.address)).toString(), toWei("1000"));

    // There should be one liquidation after the call and the properties on the liquidation should match what is expected.
    const liquidations = await financialContract.getLiquidations(sponsor1);
    await validateLiquidationOutput(liquidations);

    // In this test the DSProxy did not need to mint. However, it did need to swap to pay the final fee.
    assert.equal((await financialContract.getPastEvents("PositionCreated")).length, 0);
    assert.equal((await pair.getPastEvents("Swap")).length, 1);
    assert.equal((await financialContract.getPastEvents("LiquidationCreated")).length, 1);
  });
  it("should correctly handel collateral balance larger than required for synthetic position mint", async function () {
    // If the DSProxy's balance collateral balance is larger than then that to be minted, then it does not need to preform
    // any extra buys. However, the DSProxy still needs to mint synthetics to preform the liquidation. Send the synthetic
    // reserve token, of which it should use none. Send collateral larger than needed to mint positions.
    await reserveToken.mint(dsProxy.address, toWei("10000")); // mint some reserve tokens.
    await collateralToken.mint(dsProxy.address, toWei("10")); // send 10 collateral to the DSProxy.

    // Build the transaction call data.
    const callData = buildCallData();

    await dsProxy.contract.methods["execute(address,bytes)"](reserveCurrencyLiquidator.address, callData).send({
      from: liquidator,
    });

    // The DSProxy should have used some of it's collateral and no additional reserves when executing the liquidation.
    // The collateral remaining should be the starting amount minus that used in the mint. The GCR is 5/2000= 0.0025.
    // to liquidate the position, we require 1000 Synthetics. Therefore used collateral should be 0.0025 * 1000 = 2.5.
    // Added to this, the liquidator spent 0.1 ETH on final fee. the net balance should be 10 - 2.5 - 0.1 = 7.4.
    assert.equal((await collateralToken.balanceOf(dsProxy.address)).toString(), toWei("7.4"));
    assert.equal((await syntheticToken.balanceOf(dsProxy.address)).toString(), toWei("0"));
    assert.equal((await reserveToken.balanceOf(dsProxy.address)).toString(), toWei("10000"));

    // There should be one liquidation after the call and the properties on the liquidation should match what is expected.
    const liquidations = await financialContract.getLiquidations(sponsor1);
    await validateLiquidationOutput(liquidations);

    // In this test the DSProxy had enough collateral so did not need to swap. However, it needed to mint. Events should match.
    assert.equal((await financialContract.getPastEvents("PositionCreated")).length, 1);
    assert.equal((await pair.getPastEvents("Swap")).length, 0);
    assert.equal((await financialContract.getPastEvents("LiquidationCreated")).length, 1);
  });
  it("can correctly deal with collateral and reserve being the same token", async function () {
    // Send tokens from liquidator to DSProxy. This would be done by seeding the common DSProxy shared between multiple bots.
    await collateralToken.mint(dsProxy.address, toWei("10000"));

    // The DSProxy should not have any synthetics or collateral before the liquidation.
    assert.equal((await collateralToken.balanceOf(dsProxy.address)).toString(), toWei("10000"));
    assert.equal(await reserveToken.balanceOf(dsProxy.address), "0");
    assert.equal(await syntheticToken.balanceOf(dsProxy.address), "0");

    const startingUniswapPrice = await getPoolSpotPrice();

    // There should be no liquidations before the transaction call.
    assert.equal((await financialContract.getLiquidations(sponsor1)).length, 0);

    // Build the transaction call data. This differs from the previous tests in that it uses the collateral as reserve token.
    const callData = reserveCurrencyLiquidator.contract.methods
      .swapMintLiquidate(
        router.address, // uniswapRouter
        financialContract.address, // financialContract
        collateralToken.address, // reserveCurrency
        sponsor1, // liquidatedSponsor
        { rawValue: MAX_UINT_VAL }, // maxReserverTokenSpent
        { rawValue: 0 }, // minCollateralPerTokenLiquidated
        { rawValue: MAX_SAFE_ALLOWANCE }, // maxCollateralPerTokenLiquidated. This number need to be >= the token price.
        { rawValue: toWei("1000") }, // maxTokensToLiquidate. This is how many tokens the positions has (liquidated debt).
        unreachableDeadline
      )
      .encodeABI();

    await dsProxy.contract.methods["execute(address,bytes)"](reserveCurrencyLiquidator.address, callData).send({
      from: liquidator,
    });

    // The DSProxy should not have any synthetics or collateral after the liquidation as everything was used.
    assert.equal(await syntheticToken.balanceOf(dsProxy.address), "0");

    // There should be one liquidation after the call and the properties on the liquidation should match what is expected.
    const liquidations = await financialContract.getLiquidations(sponsor1);
    await validateLiquidationOutput(liquidations);

    // The price in the uniswap pool should not have moved at all as no trade.
    assert.equal(await getPoolSpotPrice(), startingUniswapPrice);

    // In this test the DSProxy should not swapped, but should have minted and liquidated. We should expect to see exactly these events.
    assert.equal((await financialContract.getPastEvents("PositionCreated")).length, 1);
    assert.equal((await pair.getPastEvents("Swap")).length, 0);
    assert.equal((await financialContract.getPastEvents("LiquidationCreated")).length, 1);
  });
  it("can correctly deal with collateral and reserving shortfall for liquidation size", async function () {
    // In the even that the DSProxy does not have enough collateral or reserves it should liquidate as much as posable,
    // using all ammunition it can. Send tokens from liquidator to DSProxy.Send less than the amount needed for the liquidation.
    await collateralToken.mint(dsProxy.address, toWei("1"));

    // The DSProxy should not have any synthetics or collateral before the liquidation.
    assert.equal((await collateralToken.balanceOf(dsProxy.address)).toString(), toWei("1"));
    assert.equal(await reserveToken.balanceOf(dsProxy.address), "0");
    assert.equal(await syntheticToken.balanceOf(dsProxy.address), "0");

    const startingUniswapPrice = await getPoolSpotPrice();

    // There should be no liquidations before the transaction call.
    assert.equal((await financialContract.getLiquidations(sponsor1)).length, 0);

    // Build the transaction call data. This differs from the previous tests in that it uses the collateral as reserve token.
    // Also, note that the maxTokensToLiquidate is more than the bot could do with just 1 wei of collateral.
    const callData = reserveCurrencyLiquidator.contract.methods
      .swapMintLiquidate(
        router.address, // uniswapRouter
        financialContract.address, // financialContract
        collateralToken.address, // reserveCurrency
        sponsor1, // liquidatedSponsor
        { rawValue: MAX_UINT_VAL }, // maxReserverTokenSpent
        { rawValue: 0 }, // minCollateralPerTokenLiquidated
        { rawValue: MAX_SAFE_ALLOWANCE }, // maxCollateralPerTokenLiquidated. This number need to be >= the token price.
        { rawValue: toWei("1000") }, // maxTokensToLiquidate. This is how many tokens the positions has (liquidated debt).
        unreachableDeadline
      )
      .encodeABI();

    await dsProxy.contract.methods["execute(address,bytes)"](reserveCurrencyLiquidator.address, callData).send({
      from: liquidator,
    });

    // The DSProxy should not have any synthetics or collateral after the liquidation as everything was used.
    assert.equal(await syntheticToken.balanceOf(dsProxy.address), "0");
    assert.equal(await reserveToken.balanceOf(dsProxy.address), "0");
    assert.equal(await syntheticToken.balanceOf(dsProxy.address), "0");

    // There should be one liquidation after the call and the properties on the liquidation should match what is expected.
    const liquidations = await financialContract.getLiquidations(sponsor1);

    // Cant use validateLiquidationOutput as this is a different sized liquidation.
    assert.equal(liquidations.length, 1);
    assert.equal(liquidations[0].sponsor, sponsor1); // The selected sponsor should be liquidated.
    assert.equal(liquidations[0].liquidator, dsProxy.address); // The dSProxy did the liquidation.
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
});
