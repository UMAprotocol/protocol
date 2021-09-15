const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract } = hre;
const {
  MAX_UINT_VAL,
  MAX_SAFE_ALLOWANCE,
  ZERO_ADDRESS,
  interfaceName,
  createContractObjectFromJson,
} = require("@uma/common");
const { toWei, toBN, fromWei, padRight, utf8ToHex } = web3.utils;
const { assert } = require("chai");

// Tested Contract
const ReserveCurrencyDisputer = getContract("ReserveCurrencyDisputer");

// Uniswap related contracts
const UniswapV2Factory = require("@uniswap/v2-core/build/UniswapV2Factory.json");
const IUniswapV2Pair = require("@uniswap/v2-core/build/IUniswapV2Pair.json");
const UniswapV2Router02 = require("@uniswap/v2-periphery/build/UniswapV2Router02.json");

// Helpers and other contracts
const Token = getContract("ExpandedERC20");
const ExpiringMultiParty = getContract("ExpiringMultiParty");
const Store = getContract("Store");
const Finder = getContract("Finder");
const MockOracle = getContract("MockOracle");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const Timer = getContract("Timer");
const DSProxyFactory = getContract("DSProxyFactory");
const DSProxy = getContract("DSProxy");

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
  const poolTokenABalance = toBN(await reserveToken.methods.balanceOf(pairAddress).call());
  const poolTokenBBalance = toBN(await collateralToken.methods.balanceOf(pairAddress).call());
  return Number(fromWei(poolTokenABalance.mul(toBN(toWei("1"))).div(poolTokenBBalance))).toFixed(4);
};

describe("ReserveTokenDisputer", function () {
  let accounts;
  let deployer;
  let sponsor1;
  let liquidator;
  let disputer;

  // Generate common call data for unit tests.
  const buildCallData = (liquidationId, sponsor) => {
    return reserveCurrencyDisputer.methods
      .swapDispute(
        router.options.address, // uniswapRouter
        financialContract.options.address, // financialContract
        reserveToken.options.address, // reserveCurrency
        liquidationId,
        sponsor,
        MAX_SAFE_ALLOWANCE, // maxReserveTokenSpent.
        unreachableDeadline
      )
      .encodeABI();
  };

  before(async () => {
    accounts = await web3.eth.getAccounts();
    [deployer, sponsor1, liquidator, disputer] = accounts;
    await runDefaultFixture(hre);
    dsProxyFactory = await DSProxyFactory.new().send({ from: accounts[0] });

    // Create a mockOracle and get the deployed finder. Register the mockMoracle with the finder.
    finder = await Finder.deployed();
    store = await Store.deployed();
    timer = await Timer.deployed();

    mockOracle = await MockOracle.new(finder.options.address, timer.options.address).send({ from: deployer });

    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.options.address)
      .send({ from: deployer });

    // Create identifier whitelist and register the price tracking ticker with it.
    identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.methods.addSupportedIdentifier(priceFeedIdentifier).send({ from: deployer });
  });

  beforeEach(async () => {
    // deploy the ReserveTokenLiquidator
    reserveCurrencyDisputer = await ReserveCurrencyDisputer.new().send({ from: accounts[0] });

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
    await collateralToken.methods.mint(liquidator, toWei("100000000000000")).send({ from: accounts[0] });

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

    await reserveToken.methods.mint(pairAddress, toBN(toWei("1000")).muln(10000000)).send({ from: accounts[0] });
    await collateralToken.methods.mint(pairAddress, toBN(toWei("1")).muln(10000000)).send({ from: accounts[0] });
    await pair.methods.sync().send({ from: deployer });
    assert.equal(await getPoolSpotPrice(), "1000.0000"); // price should be exactly 1000 reserveToken/collateralToken.

    // Create the EMP to mint positions.
    const constructorParams = {
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

    // Next, the liquidator creates 10000 tokens, collateralized by 30 WETH.
    await collateralToken.methods.approve(financialContract.options.address, MAX_UINT_VAL).send({ from: liquidator });
    await await financialContract.methods
      .create({ rawValue: toWei("30") }, { rawValue: toWei("10000") })
      .send({ from: liquidator });

    // There should be no liquidations before the transaction call.
    assert.equal((await financialContract.methods.getLiquidations(sponsor1).call()).length, 0);

    // Liquidate the sponsor from the liquidators account. Unit tests will assume there is a pending liquidation to dispute.
    await syntheticToken.methods.approve(financialContract.options.address, MAX_UINT_VAL).send({ from: liquidator });
    await financialContract.methods
      .createLiquidation(
        sponsor1,
        { rawValue: 0 },
        { rawValue: MAX_SAFE_ALLOWANCE },
        { rawValue: toWei("1000") },
        unreachableDeadline
      )
      .send({ from: liquidator });

    // There should be one liquidation after the call and the properties on the liquidation should match what is expected.
    const liquidations = await financialContract.methods.getLiquidations(sponsor1).call();
    assert.equal(liquidations.length, 1);
    assert.equal(liquidations[0].sponsor, sponsor1); // The selected sponsor should be liquidated.
    assert.equal(liquidations[0].state.toString(), "1"); // liquidation state should be `NotDisputed` (1)

    // Finally, create a DSProxy for the liquidator. This will be used to send the atomic liquidation transactions.
    await dsProxyFactory.methods.build().send({ from: disputer });
    dsProxy = await DSProxy.at((await dsProxyFactory.getPastEvents("Created"))[0].returnValues.proxy);
  });

  it("can correctly swap,dispute", async function () {
    // Send tokens from liquidator to DSProxy. This would be done by seeding the common DSProxy shared between multiple bots.
    await reserveToken.methods.mint(dsProxy.options.address, toWei("10000")).send({ from: accounts[0] });

    // The DSProxy should not have any synthetics or collateral before the liquidation.
    assert.equal(await collateralToken.methods.balanceOf(dsProxy.options.address).call(), "0");
    assert.equal(await syntheticToken.methods.balanceOf(dsProxy.options.address).call(), "0");

    const startingUniswapPrice = await getPoolSpotPrice();

    // Build the transaction call data.
    const callData = buildCallData(0, sponsor1);

    await dsProxy.methods["execute(address,bytes)"](reserveCurrencyDisputer.options.address, callData).send({
      from: disputer,
    });

    // The price in the uniswap pool should be greater than what it started at as we traded reserve for collateral.
    assert.equal(Number((await getPoolSpotPrice()) > Number(startingUniswapPrice)), 1);

    // The DSProxy should have no collateral left in it purchased the exact amount for the dispute.
    assert.equal(await collateralToken.methods.balanceOf(dsProxy.options.address).call(), "0");

    // The liquidation state should now be Disputed (2) and the dsProxy should be the disputer.
    const liquidation = (await financialContract.methods.getLiquidations(sponsor1).call())[0];
    assert.equal(liquidation.state.toString(), "2");
    assert.equal(liquidation.disputer.toString(), dsProxy.options.address);

    // In this test the DSProxy should have swapped and disputed. There should be events for both actions.
    assert.equal((await pair.getPastEvents("Swap")).length, 1);
    assert.equal((await financialContract.getPastEvents("LiquidationDisputed")).length, 1);
  });
  it("can use existing collateral to dispute without buying anything", async function () {
    // If the DSProxy already has any collateral, the contract should it before buying anything to fund the dispute.
    await collateralToken.methods.mint(dsProxy.options.address, toWei("10000")).send({ from: accounts[0] }); // mint enough to do the full dispute

    // There should be no reserve in the Proxy.
    assert.equal(await reserveToken.methods.balanceOf(dsProxy.options.address).call(), "0");

    const startingUniswapPrice = await getPoolSpotPrice();

    // Build the transaction call data.
    const callData = buildCallData(0, sponsor1);

    await dsProxy.methods["execute(address,bytes)"](reserveCurrencyDisputer.options.address, callData).send({
      from: disputer,
    });

    assert.equal(Number(await getPoolSpotPrice()), Number(startingUniswapPrice));

    // The liquidation state should now be Disputed (2) and the dsProxy should be the disputer.
    const liquidation = (await financialContract.methods.getLiquidations(sponsor1).call())[0];
    assert.equal(liquidation.state.toString(), "2");
    assert.equal(liquidation.disputer.toString(), dsProxy.options.address);

    // In this test the DSProxy should have only disputed, no swaps. There should only be one event for the dispute action.
    assert.equal((await pair.getPastEvents("Swap")).length, 0);
    assert.equal((await financialContract.getPastEvents("LiquidationDisputed")).length, 1);
  });
  it("can use some existing collateral and some purchased collateral to dispute", async function () {
    // If the DSProxy already has any collateral, the contract should it before buying anything to fund the dispute.
    await collateralToken.methods.mint(dsProxy.options.address, toWei("0.5")).send({ from: accounts[0] }); // mint enough to pay the final fee but not enough for the whole dispute.
    await reserveToken.methods.mint(dsProxy.options.address, toWei("10000")).send({ from: accounts[0] }); // mint some reserve tokens to buy the shortfall

    // Build the transaction call data.
    const callData = buildCallData(0, sponsor1);
    await dsProxy.methods["execute(address,bytes)"](reserveCurrencyDisputer.options.address, callData).send({
      from: disputer,
    });

    // The DSProxy should have no collateral left in as it used what was remaining before buying the exact shortfall.
    assert.equal(await collateralToken.methods.balanceOf(dsProxy.options.address).call(), "0");

    // The liquidation state should now be Disputed (2) and the dsProxy should be the disputer.
    const liquidation = (await financialContract.methods.getLiquidations(sponsor1).call())[0];
    assert.equal(liquidation.state.toString(), "2");
    assert.equal(liquidation.disputer.toString(), dsProxy.options.address);

    // In this test the DSProxy should have swapped and disputed. There should be events for both actions.
    assert.equal((await pair.getPastEvents("Swap")).length, 1);
    assert.equal((await financialContract.getPastEvents("LiquidationDisputed")).length, 1);
  });
});
