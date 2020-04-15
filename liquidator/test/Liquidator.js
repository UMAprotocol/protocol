const { toWei, hexToUtf8, toBN } = web3.utils;
const { LiquidationStatesEnum } = require("../../common/Enums");

// Script to test
const { Liquidator } = require("../liquidator.js");

// Helper client script
const { ExpiringMultiPartyClient } = require("../../financial-templates-lib/ExpiringMultiPartyClient");
const { GasEstimator } = require("../../financial-templates-lib/GasEstimator");

// Contracts and helpers
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const Finder = artifacts.require("Finder");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const MockOracle = artifacts.require("MockOracle");
const TokenFactory = artifacts.require("TokenFactory");
const Token = artifacts.require("ExpandedERC20");
const Store = artifacts.require("Store");
const Timer = artifacts.require("Timer");

contract("Liquidator.js", function(accounts) {
  // implementation uses the 0th address by default as the bot runs using the default truffle wallet accounts[0]
  const liquidatorBot = accounts[0];
  const sponsor1 = accounts[1];
  const sponsor2 = accounts[2];
  const sponsor3 = accounts[3];
  const contractCreator = accounts[4];

  let collateralToken;
  let emp;
  let liquidator;
  let syntheticToken;
  let mockOracle;
  let store;

  const setCurrentTime = async time => {
    await emp.setCurrentTime(time);
    await store.setCurrentTime(time);
    await mockOracle.setCurrentTime(time);
  };

  before(async function() {
    collateralToken = await Token.new({ from: contractCreator });
    await collateralToken.addMember(1, contractCreator, {
      from: contractCreator
    });

    // Seed the sponsors accounts.
    await collateralToken.mint(sponsor1, toWei("100000"), { from: contractCreator });
    await collateralToken.mint(sponsor2, toWei("100000"), { from: contractCreator });
    await collateralToken.mint(sponsor3, toWei("100000"), { from: contractCreator });

    // seed the liquidatorBot's wallet so it can perform liquidations.
    await collateralToken.mint(liquidatorBot, toWei("100000"), { from: contractCreator });

    // Create identifier whitelist and register the price tracking ticker with it.
    identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(web3.utils.utf8ToHex("UMATEST"));
  });

  beforeEach(async function() {
    // Create a mockOracle and finder. Register the mockMoracle with the finder.
    mockOracle = await MockOracle.new(identifierWhitelist.address, Timer.address, {
      from: contractCreator
    });
    finder = await Finder.deployed();
    const mockOracleInterfaceName = web3.utils.utf8ToHex("Oracle");
    await finder.changeImplementationAddress(mockOracleInterfaceName, mockOracle.address);

    const constructorParams = {
      expirationTimestamp: "12345678900",
      withdrawalLiveness: "1000",
      collateralAddress: collateralToken.address,
      finderAddress: Finder.address,
      tokenFactoryAddress: TokenFactory.address,
      priceFeedIdentifier: web3.utils.utf8ToHex("UMATEST"),
      syntheticName: "Test UMA Token",
      syntheticSymbol: "UMATEST",
      liquidationLiveness: "1000",
      collateralRequirement: { rawValue: toWei("1.2") },
      disputeBondPct: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPct: { rawValue: toWei("0.1") },
      disputerDisputeRewardPct: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") },
      timerAddress: Timer.address
    };

    // Deploy a new expiring multi party
    emp = await ExpiringMultiParty.new(constructorParams);

    await collateralToken.approve(emp.address, toWei("10000000"), { from: sponsor1 });
    await collateralToken.approve(emp.address, toWei("10000000"), { from: sponsor2 });
    await collateralToken.approve(emp.address, toWei("10000000"), { from: sponsor3 });
    await collateralToken.approve(emp.address, toWei("100000000"), { from: liquidatorBot });

    syntheticToken = await Token.at(await emp.tokenCurrency());
    await syntheticToken.approve(emp.address, toWei("100000000"), { from: sponsor1 });
    await syntheticToken.approve(emp.address, toWei("100000000"), { from: sponsor2 });
    await syntheticToken.approve(emp.address, toWei("100000000"), { from: sponsor3 });
    await syntheticToken.approve(emp.address, toWei("100000000"), { from: liquidatorBot });

    // Create a new instance of the ExpiringMultiPartyClient & gasEstimator to construct the liquidator
    empClient = new ExpiringMultiPartyClient(ExpiringMultiParty.abi, web3, emp.address);
    gasEstimator = new GasEstimator();

    // Create a new instance of the liquidator to test
    liquidator = new Liquidator(empClient, gasEstimator, accounts[0]);

    // Sync other contracts' time with the emp.
    await setCurrentTime(await emp.getCurrentTime());
  });

  it("Can correctly detect undercollateralized positions and liquidate them", async function() {
    // sponsor1 creates a position with 125 units of collateral, creating 100 synthetic tokens.
    await emp.create({ rawValue: toWei("125") }, { rawValue: toWei("100") }, { from: sponsor1 });

    // sponsor2 creates a position with 150 units of collateral, creating 100 synthetic tokens.
    await emp.create({ rawValue: toWei("150") }, { rawValue: toWei("100") }, { from: sponsor2 });

    // sponsor3 creates a position with 175 units of collateral, creating 100 synthetic tokens.
    await emp.create({ rawValue: toWei("175") }, { rawValue: toWei("100") }, { from: sponsor3 });

    // liquidatorBot creates a position to have synthetic tokens to pay off debt upon liquidation.
    await emp.create({ rawValue: toWei("1000") }, { rawValue: toWei("500") }, { from: liquidatorBot });

    // Start with a mocked price of 1 usd per token.
    // This puts both sponsors over collateralized so no liquidations should occur.
    await liquidator.queryAndLiquidate(time => toWei("1"));

    // There should be no liquidations created from any sponsor account
    assert.deepStrictEqual(await emp.getLiquidations(sponsor1), []);
    assert.deepStrictEqual(await emp.getLiquidations(sponsor2), []);
    assert.deepStrictEqual(await emp.getLiquidations(sponsor3), []);

    // Both token sponsors should still have their positions with full collateral
    assert.equal((await emp.getCollateral(sponsor1)).rawValue, toWei("125"));
    assert.equal((await emp.getCollateral(sponsor2)).rawValue, toWei("150"));

    // Next, assume the price feed given to the liquidator has moved such that two of the three sponsors
    // is now undercollateralize. The liquidator bot should correctly identify this and liquidate the positions.
    // A price of 1.3 USD per token puts sponsor1 and sponsor2 at undercollateralized while sponsor3 remains
    // collateralized. Numerically debt * price * coltReq > debt for collateralized position.
    // Sponsor1: 100 * 1.3 * 1.2 > 125 [undercollateralized]
    // Sponsor2: 100 * 1.3 * 1.2 > 150 [undercollateralized]
    // Sponsor2: 100 * 1.3 * 1.2 < 175 [sufficiently collateralized]

    await liquidator.queryAndLiquidate(time => toWei("1.3"));

    // Sponsor1 should be in a liquidation state with the bot as the liquidator.
    assert.equal((await emp.getLiquidations(sponsor1))[0].sponsor, sponsor1);
    assert.equal((await emp.getLiquidations(sponsor1))[0].liquidator, liquidatorBot);
    assert.equal((await emp.getLiquidations(sponsor1))[0].state, LiquidationStatesEnum.PRE_DISPUTE);
    assert.equal((await emp.getLiquidations(sponsor1))[0].liquidatedCollateral, toWei("125"));

    // Sponsor1 should have zero collateral left in their position from the liquidation.
    assert.equal((await emp.getCollateral(sponsor1)).rawValue, 0);

    // Sponsor2 should be in a liquidation state with the bot as the liquidator.
    assert.equal((await emp.getLiquidations(sponsor2))[0].sponsor, sponsor2);
    assert.equal((await emp.getLiquidations(sponsor2))[0].liquidator, liquidatorBot);
    assert.equal((await emp.getLiquidations(sponsor2))[0].state, LiquidationStatesEnum.PRE_DISPUTE);
    assert.equal((await emp.getLiquidations(sponsor2))[0].liquidatedCollateral, toWei("150"));

    // Sponsor2 should have zero collateral left in their position from the liquidation.
    assert.equal((await emp.getCollateral(sponsor2)).rawValue, 0);

    // Sponsor3 should have all their collateral left and no liquidations.
    assert.deepStrictEqual(await emp.getLiquidations(sponsor3), []);
    assert.equal((await emp.getCollateral(sponsor3)).rawValue, toWei("175"));
  });

  it("Can withdraw rewards from expired liquidations", async function() {
    // sponsor1 creates a position with 125 units of collateral, creating 100 synthetic tokens.
    await emp.create({ rawValue: toWei("125") }, { rawValue: toWei("100") }, { from: sponsor1 });

    // liquidatorBot creates a position to have synthetic tokens to pay off debt upon liquidation.
    await emp.create({ rawValue: toWei("1000") }, { rawValue: toWei("500") }, { from: liquidatorBot });

    // Next, the liquidator believes the price to be 1.3, which would make the position undercollateralized,
    // and liquidates the position.
    // Sponsor1: 100 * 1.3 * 1.2 > 125 [undercollateralized]
    await liquidator.queryAndLiquidate(time => toWei("1.3"));

    // Advance the timer to the liquidation expiry.
    const liquidationTime = (await emp.getLiquidations(sponsor1))[0].liquidationTime;
    const liquidationLiveness = 1000;
    await setCurrentTime(Number(liquidationTime) + liquidationLiveness);
    await empClient.forceUpdate();

    // Now that the liquidation has expired, the liquidator can withdraw rewards.
    const collateralPreWithdraw = await collateralToken.balanceOf(liquidatorBot);
    await liquidator.queryAndWithdrawRewards();

    // Liquidator should have their collateral increased by Sponsor1's collateral.
    const collateralPostWithdraw = await collateralToken.balanceOf(liquidatorBot);
    assert.equal(
      toBN(collateralPreWithdraw)
        .add(toBN(toWei("125")))
        .toString(),
      collateralPostWithdraw.toString()
    );

    // Liquidation data should have been deleted.
    assert.deepStrictEqual((await emp.getLiquidations(sponsor1))[0].state, LiquidationStatesEnum.UNINITIALIZED);
  });

  it("Can withdraw rewards from liquidations that were disputed unsuccessfully", async function() {
    // sponsor1 creates a position with 125 units of collateral, creating 100 synthetic tokens.
    await emp.create({ rawValue: toWei("125") }, { rawValue: toWei("100") }, { from: sponsor1 });

    // liquidatorBot creates a position to have synthetic tokens to pay off debt upon liquidation.
    await emp.create({ rawValue: toWei("1000") }, { rawValue: toWei("500") }, { from: liquidatorBot });

    // Next, the liquidator believes the price to be 1.3, which would make the position undercollateralized,
    // and liquidates the position.
    // Sponsor1: 100 * 1.3 * 1.2 > 125 [undercollateralized]
    const liquidationPrice = toWei("1.3");
    await liquidator.queryAndLiquidate(time => liquidationPrice);

    // Dispute the liquidation, which requires staking a dispute bond.
    await emp.dispute("0", sponsor1, { from: sponsor3 });
    await empClient.forceUpdate();

    // Attempt to withdraw before dispute resolves should do nothing exit gracefully.
    await liquidator.queryAndWithdrawRewards();

    // Simulate a failed dispute by pushing a price to the oracle, at the time of the liquidation request, such that
    // the position was truly undercollateralized. In other words, the liquidator was liquidating at the correct price.
    const disputePrice = toWei("1.3");
    const liquidationTime = (await emp.getLiquidations(sponsor1))[0].liquidationTime;
    await mockOracle.pushPrice(web3.utils.utf8ToHex("UMATEST"), liquidationTime, disputePrice);

    // The liquidator can now settle the dispute by calling `withdrawRewards()` because the oracle has a price
    // for the liquidation time.
    const collateralPreWithdraw = await collateralToken.balanceOf(liquidatorBot);
    await liquidator.queryAndWithdrawRewards();

    // Liquidator should have their collateral increased by Sponsor1's collateral + the disputer's dispute bond:
    // 125 + (10% of 125) = 137.5 units of collateral.
    const collateralPostWithdraw = await collateralToken.balanceOf(liquidatorBot);
    assert.equal(
      toBN(collateralPreWithdraw)
        .add(toBN(toWei("137.5")))
        .toString(),
      collateralPostWithdraw.toString()
    );

    // Liquidation data should have been deleted.
    assert.deepStrictEqual((await emp.getLiquidations(sponsor1))[0].state, LiquidationStatesEnum.UNINITIALIZED);
  });

  it("Can withdraw rewards from liquidations that were disputed successfully", async function() {
    // sponsor1 creates a position with 125 units of collateral, creating 100 synthetic tokens.
    await emp.create({ rawValue: toWei("125") }, { rawValue: toWei("100") }, { from: sponsor1 });

    // liquidatorBot creates a position to have synthetic tokens to pay off debt upon liquidation.
    await emp.create({ rawValue: toWei("1000") }, { rawValue: toWei("500") }, { from: liquidatorBot });

    // Next, the liquidator believes the price to be 1.3, which would make the position undercollateralized,
    // and liquidates the position.
    // Sponsor1: 100 * 1.3 * 1.2 > 125 [undercollateralized]
    const liquidationPrice = toWei("1.3");
    await liquidator.queryAndLiquidate(time => liquidationPrice);

    // Dispute the liquidation, which requires staking a dispute bond.
    await emp.dispute("0", sponsor1, { from: sponsor3 });
    await empClient.forceUpdate();

    // Attempt to withdraw before dispute resolves should do nothing exit gracefully.
    await liquidator.queryAndWithdrawRewards();

    // Simulate a successful dispute by pushing a price to the oracle, at the time of the liquidation request, such that
    // the position was not undercollateralized. In other words, the liquidator was liquidating at the incorrect price.
    const disputePrice = toWei("1");
    const liquidationTime = (await emp.getLiquidations(sponsor1))[0].liquidationTime;
    await mockOracle.pushPrice(web3.utils.utf8ToHex("UMATEST"), liquidationTime, disputePrice);

    // The liquidator can now settle the dispute by calling `withdrawRewards()` because the oracle has a price
    // for the liquidation time.
    const collateralPreWithdraw = await collateralToken.balanceOf(liquidatorBot);
    await liquidator.queryAndWithdrawRewards();

    // Liquidator should have their collateral increased by TRV - (disputer and sponsor rewards):
    // 100 - 2 * (10% of 100) = 80 units of collateral.
    const collateralPostWithdraw = await collateralToken.balanceOf(liquidatorBot);
    assert.equal(
      toBN(collateralPreWithdraw)
        .add(toBN(toWei("80")))
        .toString(),
      collateralPostWithdraw.toString()
    );
  });

  it("Detect if the liquidator cannot liquidate due to capital constraints", async function() {
    // sponsor1 creates a position with 125 units of collateral, creating 100 synthetic tokens.
    await emp.create({ rawValue: toWei("125") }, { rawValue: toWei("100") }, { from: sponsor1 });

    // Next, the liquidator believes the price to be 1.3, which would make the position undercollateralized,
    // and liquidates the position.
    // Sponsor1: 100 * 1.3 * 1.2 > 125 [undercollateralized]
    const liquidationPrice = toWei("1.3");

    // No transaction should be sent, so this should not throw.
    await liquidator.queryAndLiquidate(time => liquidationPrice);

    // No liquidations should have gone through.
    assert.equal((await emp.getLiquidations(sponsor1)).length, 0);

    // liquidatorBot creates a position to have synthetic tokens to pay off debt upon liquidation.
    await emp.create({ rawValue: toWei("1000") }, { rawValue: toWei("500") }, { from: liquidatorBot });
    // No need to force update the `empClient` here since we are not interested in detecting the `liquidatorBot`'s new position,
    // but now when we try to liquidate the position the liquidation will go through because the bot will have the requisite balance.

    // Can now liquidate the position.
    await liquidator.queryAndLiquidate(time => liquidationPrice);

    // The liquidation should have gone through.
    assert.equal((await emp.getLiquidations(sponsor1)).length, 1);
  });
});
