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
const DSProxyFactory = getTruffleContract("DSProxyFactory", web3, "latest");
const DSProxy = getTruffleContract("DSProxy", web3, "latest");

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
const createContractObjectFromJson = contractJsonObject => {
  let truffleContractCreator = truffleContract(contractJsonObject);
  truffleContractCreator.setProvider(web3.currentProvider);
  return truffleContractCreator;
};

contract("ReserveTokenLiquidator", function(accounts) {
  const deployer = accounts[0];
  const sponsor1 = accounts[1];
  const sponsor2 = accounts[2];
  const liquidator = accounts[2];

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
    await store.setFinalFee(collateralToken.address, { rawValue: finalFeeAmount.toString() });

    await reserveToken.addMember(1, deployer, { from: deployer });
    await collateralToken.addMember(1, deployer, { from: deployer });

    // Give the sponsors collateral Token to create positions.
    await collateralToken.mint(sponsor1, toWei("100000000000000"));
    await collateralToken.mint(sponsor2, toWei("100000000000000"));

    // Give the liquidator ONLY reserve Token. This address will need to buy collateral from uniswap when liquidating.
    await reserveToken.mint(liquidator, toWei("100000000000000"));

    // deploy Uniswap V2 Factory & router.
    factory = await createContractObjectFromJson(UniswapV2Factory).new(deployer, {
      from: deployer
    });
    router = await createContractObjectFromJson(UniswapV2Router02).new(factory.address, collateralToken.address, {
      from: deployer
    });

    // initialize the pair
    await factory.createPair(reserveToken.address, collateralToken.address, {
      from: deployer
    });
    pairAddress = await factory.getPair(reserveToken.address, collateralToken.address);
    pair = await createContractObjectFromJson(IUniswapV2Pair).at(pairAddress);

    await reserveToken.mint(pairAddress, toBN(toWei("1000")).muln(10000000));
    await collateralToken.mint(pairAddress, toBN(toWei("1")).muln(10000000));
    await pair.sync({ from: deployer });
    assert.equal(await getPoolSpotPrice(), "1000.0000"); // price should be exactly 1000 reserveToken/collateralToken.

    // Create the EMP to mint positions.
    syntheticToken = await Token.new("Test Synthetic Token", "SYNTH", 18, { from: accounts[0] });
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
      financialProductLibraryAddress: ZERO_ADDRESS
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

  it("Broker can correctly trade the price up to a desired price", async function() {
    // Send tokens from liquidator to DSProxy. This would be done by seeding the common DSProxy shared between multiple bots.

    await reserveToken.transfer(dsProxy.address, toWei("10000"), { from: liquidator });

    const startingUniswapPrice = await getPoolSpotPrice();

    // There should be no liquidations before the transaction call.
    assert.equal((await financialContract.getLiquidations(sponsor1)).length, 0);
    const callData = reserveCurrencyLiquidator.contract.methods
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

    await dsProxy.contract.methods["execute(address,bytes)"](reserveCurrencyLiquidator.address, callData).send({
      from: liquidator
    });

    // There should be one liquidation after the call and the properties on the liquidation should match what is expected.
    const liquidations = await financialContract.getLiquidations(sponsor1);
    assert.equal(liquidations.length, 1);
    assert.equal(liquidations[0].sponsor, sponsor1); // The selected sponsor should be liquidated.
    assert.equal(liquidations[0].liquidator, dsProxy.address); // The dSProxy did the liquidation.
    assert.equal(liquidations[0].tokensOutstanding.toString(), toWei("1000")); // The full position should be liquidated.
    assert.equal(liquidations[0].lockedCollateral.toString(), toWei("2")); // The full position's collateral should be locked.
    assert.equal(liquidations[0].liquidatedCollateral.toString(), toWei("2")); // The full position's collateral should be liquidated.
    assert.equal(liquidations[0].disputer, ZERO_ADDRESS); // The liquidation should be undisputed.
    assert.equal(liquidations[0].settlementPrice.toString(), toWei("0")); // The liquidation should not have a price (undisputed)
    assert.equal(liquidations[0].finalFee.toString(), finalFeeAmount.toString()); // The final fee should not match the expected amount

    // The price in the uniswap pool should be greater than what it started at as we traded reserve for collateral.
    assert.equal(Number((await getPoolSpotPrice()) > Number(startingUniswapPrice)), 1);
  });
});
