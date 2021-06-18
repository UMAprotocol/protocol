const {
  MAX_UINT_VAL,
  MAX_SAFE_ALLOWANCE,
  ZERO_ADDRESS,
  interfaceName,
  createContractObjectFromJson,
} = require("@uma/common");
const { toWei, toBN, fromWei, padRight, utf8ToHex } = web3.utils;
const { getTruffleContract } = require("@uma/core");
const { assert } = require("chai");

// Tested Contract
const ReserveCurrencyDisputer = getTruffleContract("ReserveCurrencyDisputer", web3);

// Uniswap related contracts
const UniswapV2Factory = require("@uniswap/v2-core/build/UniswapV2Factory.json");
const IUniswapV2Pair = require("@uniswap/v2-core/build/IUniswapV2Pair.json");
const UniswapV2Router02 = require("@uniswap/v2-periphery/build/UniswapV2Router02.json");

// Helpers and other contracts
const Token = getTruffleContract("ExpandedERC20", web3);
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const Store = artifacts.require("Store");
const Finder = artifacts.require("Finder");
const MockOracle = artifacts.require("MockOracle");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const Timer = artifacts.require("Timer");
const DSProxyFactory = getTruffleContract("DSProxyFactory", web3);
const DSProxy = getTruffleContract("DSProxy", web3);

// Tested contract
let reserveCurrencyDisputer;

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
let mockOracle;
let store;

const priceFeedIdentifier = padRight(utf8ToHex("TEST_IDENTIFIER"), 64);
const unreachableDeadline = 4772084478; // 100 years in the future
const finalFeeAmount = toBN(toWei("0.5"));

// Returns the current spot price of a uniswap pool, scaled to 4 decimal points.
const getPoolSpotPrice = async () => {
  const poolTokenABallance = await reserveToken.balanceOf(pairAddress);
  const poolTokenBBallance = await collateralToken.balanceOf(pairAddress);
  return Number(fromWei(poolTokenABallance.mul(toBN(toWei("1"))).div(poolTokenBBallance))).toFixed(4);
};

contract("ReserveTokenDisputer", function (accounts) {
  const deployer = accounts[0];
  const sponsor1 = accounts[1];
  const liquidator = accounts[2];
  const disputer = accounts[3];

  // Generate common call data for unit tests.
  const buildCallData = (liquidationId, sponsor) => {
    return reserveCurrencyDisputer.contract.methods
      .swapDispute(
        router.address, // uniswapRouter
        financialContract.address, // financialContract
        reserveToken.address, // reserveCurrency
        liquidationId,
        sponsor,
        MAX_SAFE_ALLOWANCE, // maxReserveTokenSpent.
        unreachableDeadline
      )
      .encodeABI();
  };

  before(async () => {
    dsProxyFactory = await DSProxyFactory.new();

    // Create a mockOracle and get the deployed finder. Register the mockMoracle with the finder.
    finder = await Finder.deployed();
    store = await Store.deployed();
    timer = await Timer.deployed();

    mockOracle = await MockOracle.new(finder.address, timer.address, { from: deployer });

    await finder.changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.address, { from: deployer });

    // Create identifier whitelist and register the price tracking ticker with it.
    identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(priceFeedIdentifier, { from: deployer });
  });
  beforeEach(async () => {
    // deploy the ReserveTokenLiquidator
    reserveCurrencyDisputer = await ReserveCurrencyDisputer.new();

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
    await collateralToken.mint(liquidator, toWei("100000000000000"));

    // deploy Uniswap V2 Factory & router.
    factory = await createContractObjectFromJson(UniswapV2Factory, web3).new(deployer, { from: deployer });
    router = await createContractObjectFromJson(UniswapV2Router02, web3).new(factory.address, collateralToken.address, {
      from: deployer,
    });

    // initialize the pair
    await factory.createPair(reserveToken.address, collateralToken.address, { from: deployer });
    pairAddress = await factory.getPair(reserveToken.address, collateralToken.address);
    pair = await createContractObjectFromJson(IUniswapV2Pair, web3).at(pairAddress);

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

    // Next, the liquidator creates 10000 tokens, collateralized by 30 WETH.
    await collateralToken.approve(financialContract.address, MAX_UINT_VAL, { from: liquidator });
    await await financialContract.create({ rawValue: toWei("30") }, { rawValue: toWei("10000") }, { from: liquidator });

    // There should be no liquidations before the transaction call.
    assert.equal((await financialContract.getLiquidations(sponsor1)).length, 0);

    // Liquidate the sponsor from the liquidators account. Unit tests will assume there is a pending liquidation to dispute.
    await syntheticToken.approve(financialContract.address, MAX_UINT_VAL, { from: liquidator });
    await financialContract.createLiquidation(
      sponsor1,
      { rawValue: 0 },
      { rawValue: MAX_SAFE_ALLOWANCE },
      { rawValue: toWei("1000") },
      unreachableDeadline,
      { from: liquidator }
    );

    // There should be one liquidation after the call and the properties on the liquidation should match what is expected.
    const liquidations = await financialContract.getLiquidations(sponsor1);
    assert.equal(liquidations.length, 1);
    assert.equal(liquidations[0].sponsor, sponsor1); // The selected sponsor should be liquidated.
    assert.equal(liquidations[0].state.toString(), "1"); // liquidation state should be `NotDisputed` (1)

    // Finally, create a DSProxy for the liquidator. This will be used to send the atomic liquidation transactions.
    await dsProxyFactory.build({ from: disputer });
    dsProxy = await DSProxy.at((await dsProxyFactory.getPastEvents("Created"))[0].returnValues.proxy);
  });

  it("can correctly swap,dispute", async function () {
    // Send tokens from liquidator to DSProxy. This would be done by seeding the common DSProxy shared between multiple bots.
    await reserveToken.mint(dsProxy.address, toWei("10000"));

    // The DSProxy should not have any synthetics or collateral before the liquidation.
    assert.equal(await collateralToken.balanceOf(dsProxy.address), "0");
    assert.equal(await syntheticToken.balanceOf(dsProxy.address), "0");

    const startingUniswapPrice = await getPoolSpotPrice();

    // Build the transaction call data.
    const callData = buildCallData(0, sponsor1);

    await dsProxy.contract.methods["execute(address,bytes)"](reserveCurrencyDisputer.address, callData).send({
      from: disputer,
    });

    // The price in the uniswap pool should be greater than what it started at as we traded reserve for collateral.
    assert.equal(Number((await getPoolSpotPrice()) > Number(startingUniswapPrice)), 1);

    // The DSProxy should have no collateral left in it purchased the exact amount for the dispute.
    assert.equal(await collateralToken.balanceOf(dsProxy.address), "0");

    // The liquidation state should now be Disputed (2) and the dsProxy should be the disputer.
    const liquidation = (await financialContract.getLiquidations(sponsor1))[0];
    assert.equal(liquidation.state.toString(), "2");
    assert.equal(liquidation.disputer.toString(), dsProxy.address);

    // In this test the DSProxy should have swapped and disputed. There should be events for both actions.
    assert.equal((await pair.getPastEvents("Swap")).length, 1);
    assert.equal((await financialContract.getPastEvents("LiquidationDisputed")).length, 1);
  });
  it("can use existing collateral to dispute without buying anything", async function () {
    // If the DSProxy already has any collateral, the contract should it before buying anything to fund the dispute.
    await collateralToken.mint(dsProxy.address, toWei("10000")); // mint enough to do the full dispute

    // There should be no reserve in the Proxy.
    assert.equal(await reserveToken.balanceOf(dsProxy.address), "0");

    const startingUniswapPrice = await getPoolSpotPrice();

    // Build the transaction call data.
    const callData = buildCallData(0, sponsor1);

    await dsProxy.contract.methods["execute(address,bytes)"](reserveCurrencyDisputer.address, callData).send({
      from: disputer,
    });

    assert.equal(Number(await getPoolSpotPrice()), Number(startingUniswapPrice));

    // The liquidation state should now be Disputed (2) and the dsProxy should be the disputer.
    const liquidation = (await financialContract.getLiquidations(sponsor1))[0];
    assert.equal(liquidation.state.toString(), "2");
    assert.equal(liquidation.disputer.toString(), dsProxy.address);

    // In this test the DSProxy should have only disputed, no swaps. There should only be one event for the dispute action.
    assert.equal((await pair.getPastEvents("Swap")).length, 0);
    assert.equal((await financialContract.getPastEvents("LiquidationDisputed")).length, 1);
  });
  it("can use some existing collateral and some purchased collateral to dispute", async function () {
    // If the DSProxy already has any collateral, the contract should it before buying anything to fund the dispute.
    await collateralToken.mint(dsProxy.address, toWei("0.5")); // mint enough to pay the final fee but not enough for the whole dispute.
    await reserveToken.mint(dsProxy.address, toWei("10000")); // mint some reserve tokens to buy the shortfall

    // Build the transaction call data.
    const callData = buildCallData(0, sponsor1);
    console.log("a");
    await dsProxy.contract.methods["execute(address,bytes)"](reserveCurrencyDisputer.address, callData).send({
      from: disputer,
    });
    console.log("b");

    // The DSProxy should have no collateral left in as it used what was remaining before buying the exact shortfall.
    assert.equal(await collateralToken.balanceOf(dsProxy.address), "0");

    // The liquidation state should now be Disputed (2) and the dsProxy should be the disputer.
    const liquidation = (await financialContract.getLiquidations(sponsor1))[0];
    assert.equal(liquidation.state.toString(), "2");
    assert.equal(liquidation.disputer.toString(), dsProxy.address);

    // In this test the DSProxy should have swapped and disputed. There should be events for both actions.
    assert.equal((await pair.getPastEvents("Swap")).length, 1);
    assert.equal((await financialContract.getPastEvents("LiquidationDisputed")).length, 1);
  });
});
