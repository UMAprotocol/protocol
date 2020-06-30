const { toWei, toBN } = web3.utils;
const winston = require("winston");
const sinon = require("sinon");
const { LiquidationStatesEnum, PostWithdrawLiquidationRewardsStatusTranslations } = require("../../common/Enums");
const { interfaceName } = require("../../core/utils/Constants.js");

// Script to test
const { Liquidator } = require("../liquidator.js");

// Helper client script
const { ExpiringMultiPartyClient } = require("../../financial-templates-lib/clients/ExpiringMultiPartyClient");
const { GasEstimator } = require("../../financial-templates-lib/helpers/GasEstimator");
const { PriceFeedMock } = require("../../financial-templates-lib/test/price-feed/PriceFeedMock");

// Custom winston transport module to monitor winston log outputs
const {
  SpyTransport,
  lastSpyLogLevel,
  spyLogIncludes,
  spyLogLevel
} = require("../../financial-templates-lib/logger/SpyTransport");

// Contracts and helpers
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const Finder = artifacts.require("Finder");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const MockOracle = artifacts.require("MockOracle");
const TokenFactory = artifacts.require("TokenFactory");
const Token = artifacts.require("ExpandedERC20");
const Timer = artifacts.require("Timer");

contract("Liquidator.js", function(accounts) {
  // Implementation uses the 0th address by default as the bot runs using the default truffle wallet accounts[0].
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
  let priceFeedMock;

  let spy;
  let spyLogger;

  let liquidatorConfig;
  let empProps;

  before(async function() {
    collateralToken = await Token.new("UMA", "UMA", 18, { from: contractCreator });
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
    finder = await Finder.deployed();
    mockOracle = await MockOracle.new(finder.address, Timer.address, {
      from: contractCreator
    });
    const mockOracleInterfaceName = web3.utils.utf8ToHex(interfaceName.Oracle);
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
      minSponsorTokens: { rawValue: toWei("5") },
      timerAddress: Timer.address
    };

    // Deploy a new expiring multi party
    emp = await ExpiringMultiParty.new(constructorParams);

    empProps = {
      crRatio: await emp.collateralRequirement(),
      minSponsorSize: await emp.minSponsorTokens(),
      priceIdentifier: await emp.priceIdentifier()
    };

    await collateralToken.approve(emp.address, toWei("10000000"), { from: sponsor1 });
    await collateralToken.approve(emp.address, toWei("10000000"), { from: sponsor2 });
    await collateralToken.approve(emp.address, toWei("10000000"), { from: sponsor3 });
    await collateralToken.approve(emp.address, toWei("100000000"), { from: liquidatorBot });

    syntheticToken = await Token.at(await emp.tokenCurrency());
    await syntheticToken.approve(emp.address, toWei("100000000"), { from: sponsor1 });
    await syntheticToken.approve(emp.address, toWei("100000000"), { from: sponsor2 });
    await syntheticToken.approve(emp.address, toWei("100000000"), { from: sponsor3 });
    await syntheticToken.approve(emp.address, toWei("100000000"), { from: liquidatorBot });

    spy = sinon.spy();

    spyLogger = winston.createLogger({
      level: "info",
      transports: [new SpyTransport({ level: "info" }, { spy: spy })]
    });

    // Create a new instance of the ExpiringMultiPartyClient & gasEstimator to construct the liquidator
    empClient = new ExpiringMultiPartyClient(spyLogger, ExpiringMultiParty.abi, web3, emp.address);
    gasEstimator = new GasEstimator(spyLogger);

    // Create a new instance of the price feed mock.
    priceFeedMock = new PriceFeedMock();

    // Create a new instance of the liquidator to test
    liquidatorConfig = {
      crThreshold: 0
    };
    liquidator = new Liquidator(
      spyLogger,
      empClient,
      gasEstimator,
      priceFeedMock,
      accounts[0],
      empProps,
      liquidatorConfig
    );
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
    priceFeedMock.setCurrentPrice(toBN(toWei("1")));
    await liquidator.queryAndLiquidate();
    assert.equal(spy.callCount, 0); // No info level logs should be sent.

    // Both token sponsors should still have their positions with full collateral.
    assert.equal((await emp.getCollateral(sponsor1)).rawValue, toWei("125"));
    assert.equal((await emp.getCollateral(sponsor2)).rawValue, toWei("150"));

    // No liquidations if the price feed returns an invalid value.
    priceFeedMock.setCurrentPrice(null);
    await liquidator.queryAndLiquidate();

    // One warn log should be sent since the price feed returned a bad value.
    assert.equal(spy.callCount, 1);

    // There should be no liquidations created from any sponsor account
    assert.deepStrictEqual(await emp.getLiquidations(sponsor1), []);
    assert.deepStrictEqual(await emp.getLiquidations(sponsor2), []);
    assert.deepStrictEqual(await emp.getLiquidations(sponsor3), []);

    // Next, assume the price feed given to the liquidator has moved such that two of the three sponsors
    // are now undercollateralized. The liquidator bot should correctly identify this and liquidate the positions.
    // A price of 1.3 USD per token puts sponsor1 and sponsor2 at undercollateralized while sponsor3 remains
    // collateralized. Numerically debt * price * coltReq > debt for collateralized position.
    // Sponsor1: 100 * 1.3 * 1.2 > 125 [undercollateralized]
    // Sponsor2: 100 * 1.3 * 1.2 > 150 [undercollateralized]
    // Sponsor3: 100 * 1.3 * 1.2 < 175 [sufficiently collateralized]

    priceFeedMock.setCurrentPrice(toBN(toWei("1.3")));
    await liquidator.queryAndLiquidate();
    assert.equal(spy.callCount, 3); // 2 info level events should be sent at the conclusion of the 2 liquidations.

    // Sponsor1 should be in a liquidation state with the bot as the liquidator.
    let liquidationObject = (await emp.getLiquidations(sponsor1))[0];
    assert.equal(liquidationObject.sponsor, sponsor1);
    assert.equal(liquidationObject.liquidator, liquidatorBot);
    assert.equal(liquidationObject.state, LiquidationStatesEnum.PRE_DISPUTE);
    assert.equal(liquidationObject.liquidatedCollateral, toWei("125"));

    // Sponsor1 should have zero collateral left in their position from the liquidation.
    assert.equal((await emp.getCollateral(sponsor1)).rawValue, 0);

    // Sponsor2 should be in a liquidation state with the bot as the liquidator.
    liquidationObject = (await emp.getLiquidations(sponsor2))[0];
    assert.equal(liquidationObject.sponsor, sponsor2);
    assert.equal(liquidationObject.liquidator, liquidatorBot);
    assert.equal(liquidationObject.state, LiquidationStatesEnum.PRE_DISPUTE);
    assert.equal(liquidationObject.liquidatedCollateral, toWei("150"));

    // Sponsor2 should have zero collateral left in their position from the liquidation.
    assert.equal((await emp.getCollateral(sponsor2)).rawValue, 0);

    // Sponsor3 should have all their collateral left and no liquidations.
    assert.deepStrictEqual(await emp.getLiquidations(sponsor3), []);
    assert.equal((await emp.getCollateral(sponsor3)).rawValue, toWei("175"));

    // Another query at the same price should execute no new liquidations.
    priceFeedMock.setCurrentPrice(toBN(toWei("1.3")));
    await liquidator.queryAndLiquidate();
    assert.equal(spy.callCount, 3);
  });

  it("Can correctly detect invalid withdrawals and liquidate them", async function() {
    // sponsor1 creates a position with 125 units of collateral, creating 100 synthetic tokens.
    await emp.create({ rawValue: toWei("125") }, { rawValue: toWei("100") }, { from: sponsor1 });

    // sponsor2 creates a position with 150 units of collateral, creating 100 synthetic tokens.
    await emp.create({ rawValue: toWei("150") }, { rawValue: toWei("100") }, { from: sponsor2 });

    // liquidatorBot creates a position to have synthetic tokens to pay off debt upon liquidation.
    await emp.create({ rawValue: toWei("1000") }, { rawValue: toWei("500") }, { from: liquidatorBot });

    // Start with a mocked price of 1 usd per token.
    // This puts both sponsors over collateralized so no liquidations should occur.
    priceFeedMock.setCurrentPrice(toBN(toWei("1")));
    await liquidator.queryAndLiquidate();
    assert.equal(spy.callCount, 0); // No info level logs should be sent.

    // There should be no liquidations created from any sponsor account
    assert.deepStrictEqual(await emp.getLiquidations(sponsor1), []);
    assert.deepStrictEqual(await emp.getLiquidations(sponsor2), []);

    // Both token sponsors should still have their positions with full collateral.
    assert.equal((await emp.getCollateral(sponsor1)).rawValue, toWei("125"));
    assert.equal((await emp.getCollateral(sponsor2)).rawValue, toWei("150"));

    // If sponsor1 requests a withdrawal of any amount of collateral above 5 units at the given price of 1 usd per token
    // their remaining position becomes undercollateralized. Say they request to withdraw 10 units of collateral.
    // This places their position with a CR of: 115 / (100 * 1) * 100 = 115%. This is below the CR threshold.
    await emp.requestWithdrawal({ rawValue: toWei("10") }, { from: sponsor1 });

    priceFeedMock.setCurrentPrice(toBN(toWei("1")));
    await liquidator.queryAndLiquidate();
    assert.equal(spy.callCount, 1); // There should be one log from the liquidation event of the withdrawal.

    // There should be exactly one liquidation in sponsor1's account. The liquidated collateral should be the original
    // amount of collateral minus the collateral withdrawn. 125 - 10 = 115
    let liquidationObject = (await emp.getLiquidations(sponsor1))[0];
    assert.equal(liquidationObject.sponsor, sponsor1);
    assert.equal(liquidationObject.liquidator, liquidatorBot);
    assert.equal(liquidationObject.state, LiquidationStatesEnum.PRE_DISPUTE);
    assert.equal(liquidationObject.liquidatedCollateral, toWei("115"));
    assert.equal(liquidationObject.lockedCollateral, toWei("125"));

    // Advance the timer to the liquidation expiry.
    const liquidationTime = liquidationObject.liquidationTime;
    const liquidationLiveness = 1000;
    await emp.setCurrentTime(Number(liquidationTime) + liquidationLiveness);

    // Now that the liquidation has expired, the liquidator can withdraw rewards.
    const collateralPreWithdraw = await collateralToken.balanceOf(liquidatorBot);
    await liquidator.queryAndWithdrawRewards();
    assert.equal(spy.callCount, 2); // 1 new info level events should be sent at the conclusion of the withdrawal. total 2.

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

    // The other two positions should not have any liquidations associated with them.
    assert.deepStrictEqual(await emp.getLiquidations(sponsor2), []);
  });

  it("Can withdraw rewards from expired liquidations", async function() {
    // sponsor1 creates a position with 125 units of collateral, creating 100 synthetic tokens.
    await emp.create({ rawValue: toWei("125") }, { rawValue: toWei("100") }, { from: sponsor1 });

    // liquidatorBot creates a position to have synthetic tokens to pay off debt upon liquidation.
    await emp.create({ rawValue: toWei("1000") }, { rawValue: toWei("500") }, { from: liquidatorBot });

    // Next, the liquidator believes the price to be 1.3, which would make the position undercollateralized,
    // and liquidates the position.
    // Sponsor1: 100 * 1.3 * 1.2 > 125 [undercollateralized]
    priceFeedMock.setCurrentPrice(toBN(toWei("1.3")));
    await liquidator.queryAndLiquidate();
    assert.equal(spy.callCount, 1); // 1 info level events should be sent at the conclusion of the liquidation.

    // Advance the timer to the liquidation expiry.
    const liquidationTime = (await emp.getLiquidations(sponsor1))[0].liquidationTime;
    const liquidationLiveness = 1000;
    await emp.setCurrentTime(Number(liquidationTime) + liquidationLiveness);

    // Now that the liquidation has expired, the liquidator can withdraw rewards.
    const collateralPreWithdraw = await collateralToken.balanceOf(liquidatorBot);
    await liquidator.queryAndWithdrawRewards();
    assert.equal(spy.callCount, 2); // 1 new info level events should be sent at the conclusion of the withdrawal. Total 2.

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
    priceFeedMock.setCurrentPrice(toBN(toWei("1.3")));
    await liquidator.queryAndLiquidate();
    assert.equal(spy.callCount, 1); // 1 info level events should be sent at the conclusion of the liquidation.

    // Dispute the liquidation, which requires staking a dispute bond.
    await emp.dispute("0", sponsor1, { from: sponsor3 });

    // Attempt to withdraw before dispute resolves should do nothing exit gracefully.
    await liquidator.queryAndWithdrawRewards();
    assert.equal(spy.callCount, 1); // no new info level events as too early.

    // Simulate a failed dispute by pushing a price to the oracle, at the time of the liquidation request, such that
    // the position was truly undercollateralized. In other words, the liquidator was liquidating at the correct price.
    const disputePrice = toWei("1.3");
    const liquidationTime = (await emp.getLiquidations(sponsor1))[0].liquidationTime;
    await mockOracle.pushPrice(web3.utils.utf8ToHex("UMATEST"), liquidationTime, disputePrice);

    // The liquidator can now settle the dispute by calling `withdrawRewards()` because the oracle has a price
    // for the liquidation time.
    const collateralPreWithdraw = await collateralToken.balanceOf(liquidatorBot);
    await liquidator.queryAndWithdrawRewards();
    assert.equal(spy.callCount, 2); // 1 new info level event should be sent due to the withdrawal.

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

    // Check that the log includes a human readable translation of the liquidation status, and the dispute price.
    assert.equal(
      spy.getCall(-1).lastArg.liquidationResult.liquidationStatus,
      PostWithdrawLiquidationRewardsStatusTranslations[LiquidationStatesEnum.UNINITIALIZED]
    );
    assert.equal(spy.getCall(-1).lastArg.liquidationResult.resolvedPrice, toWei("1.3"));

    // After the dispute is resolved, the liquidation should no longer exist and there should be no disputes to withdraw rewards from.
    await liquidator.queryAndWithdrawRewards();
    assert.equal(spy.callCount, 2);
  });

  it("Can withdraw rewards from liquidations that were disputed successfully", async function() {
    // sponsor1 creates a position with 125 units of collateral, creating 100 synthetic tokens.
    await emp.create({ rawValue: toWei("125") }, { rawValue: toWei("100") }, { from: sponsor1 });

    // liquidatorBot creates a position to have synthetic tokens to pay off debt upon liquidation.
    await emp.create({ rawValue: toWei("1000") }, { rawValue: toWei("500") }, { from: liquidatorBot });

    // Next, the liquidator believes the price to be 1.3, which would make the position undercollateralized,
    // and liquidates the position.
    // Sponsor1: 100 * 1.3 * 1.2 > 125 [undercollateralized]
    priceFeedMock.setCurrentPrice(toBN(toWei("1.3")));
    await liquidator.queryAndLiquidate();
    assert.equal(spy.callCount, 1); // 1 info level events should be sent at the conclusion of the liquidation.

    // Dispute the liquidation, which requires staking a dispute bond.
    await emp.dispute("0", sponsor1, { from: sponsor3 });

    // Attempt to withdraw before dispute resolves should do nothing exit gracefully.
    await liquidator.queryAndWithdrawRewards();
    assert.equal(spy.callCount, 1); // no new info level events as too early.

    // Simulate a successful dispute by pushing a price to the oracle, at the time of the liquidation request, such that
    // the position was not undercollateralized. In other words, the liquidator was liquidating at the incorrect price.
    const disputePrice = toWei("1");
    const liquidationTime = (await emp.getLiquidations(sponsor1))[0].liquidationTime;
    await mockOracle.pushPrice(web3.utils.utf8ToHex("UMATEST"), liquidationTime, disputePrice);

    // The liquidator can now settle the dispute by calling `withdrawRewards()` because the oracle has a price
    // for the liquidation time.
    const collateralPreWithdraw = await collateralToken.balanceOf(liquidatorBot);
    await liquidator.queryAndWithdrawRewards();
    assert.equal(spy.callCount, 2); // 1 new info level event should be sent due to the withdrawal.

    // Liquidator should have their collateral increased by TRV - (disputer and sponsor rewards):
    // 100 - 2 * (10% of 100) = 80 units of collateral.
    const collateralPostWithdraw = await collateralToken.balanceOf(liquidatorBot);
    assert.equal(
      toBN(collateralPreWithdraw)
        .add(toBN(toWei("80")))
        .toString(),
      collateralPostWithdraw.toString()
    );

    // Check that the log includes a human readable translation of the liquidation status, and the dispute price.
    assert.equal(
      spy.getCall(-1).lastArg.liquidationResult.liquidationStatus,
      PostWithdrawLiquidationRewardsStatusTranslations[LiquidationStatesEnum.DISPUTE_SUCCEEDED]
    );
    assert.equal(spy.getCall(-1).lastArg.liquidationResult.resolvedPrice, toWei("1"));

    // After the dispute is resolved, the liquidation should still exist but the liquidator should no longer be able to withdraw any rewards.
    await liquidator.queryAndWithdrawRewards();
    assert.equal(spy.callCount, 2);
  });

  it("Detect if the liquidator cannot liquidate due to capital constraints", async function() {
    // sponsor1 creates a position with 125 units of collateral, creating 100 synthetic tokens.
    await emp.create({ rawValue: toWei("125") }, { rawValue: toWei("100") }, { from: sponsor1 });

    // Next, the liquidator believes the price to be 1.3, which would make the position undercollateralized,
    // and liquidates the position.
    // Sponsor1: 100 * 1.3 * 1.2 > 125 [undercollateralized]
    priceFeedMock.setCurrentPrice(toBN(toWei("1.3")));

    // No transaction should be sent, so this should not throw.
    await liquidator.queryAndLiquidate();
    assert.equal(spy.callCount, 1); // 1 new error level event due to the failed liquidation.

    // No liquidations should have gone through.
    assert.equal((await emp.getLiquidations(sponsor1)).length, 0);

    // liquidatorBot creates a position to have synthetic tokens to pay off debt upon liquidation.
    await emp.create({ rawValue: toWei("1000") }, { rawValue: toWei("500") }, { from: liquidatorBot });
    // No need to force update the `empClient` here since we are not interested in detecting the `liquidatorBot`'s new
    // position, but now when we try to liquidate the position the liquidation will go through because the bot will have
    // the requisite balance.

    // Can now liquidate the position.
    priceFeedMock.setCurrentPrice(toBN(toWei("1.3")));
    await liquidator.queryAndLiquidate();
    assert.equal(spy.callCount, 2); // 1 new info level event due to the successful liquidation.

    // The liquidation should have gone through.
    assert.equal((await emp.getLiquidations(sponsor1)).length, 1);
    assert.equal(spy.callCount, 2); // 1 new log level event due to the successful execution.
  });

  describe("Partial liquidations", function() {
    it("amount-to-liquidate > min-sponsor-tokens", async function() {
      // We'll attempt to liquidate 6 tokens. The minimum sponsor position is 5. There are 3 different scenarios
      // we should test for, each of which we'll attempt to liquidate in one call of `queryAndLiquidate`.
      const amountToLiquidate = toWei("6");

      // 1. (tokens-outstanding - amount-to-liquidate) > min-sponsor-tokens, and amount-to-liquidate < tokens-outstanding
      //     - The bot will be able to liquidate its desired amount, leaving the position above the minimum token threshold.
      //     - Example: (12 - 6) > 5, new position will have 6 tokens remaining.
      await emp.create({ rawValue: toWei("100") }, { rawValue: toWei("12") }, { from: sponsor1 });
      // 2. (tokens-outstanding - amount-to-liquidate) <= min-sponsor-tokens, and amount-to-liquidate < tokens-outstanding
      //     - The bot will NOT be able to liquidate its desired amount. It will liquidate a reduced amount and
      //       reduce the position exactly to the minimum.
      //     - Example: (8 - 6) <= 5, so instead the bot will liquidate (8 - 5) = 3 tokens to leave the position with (8 - 3) = 5 tokens remaining.
      await emp.create({ rawValue: toWei("100") }, { rawValue: toWei("8") }, { from: sponsor2 });
      // 3. amount-to-liquidate > tokens-outstanding
      //     - The bot will liquidate the full position.
      //     - Example: 6 > 5, so the bot will liquidate 5 tokens.
      await emp.create({ rawValue: toWei("100") }, { rawValue: toWei("5") }, { from: sponsor3 });

      // liquidatorBot creates a position with enough tokens to liquidate all positions.
      await emp.create({ rawValue: toWei("10000") }, { rawValue: toWei("50") }, { from: liquidatorBot });

      // Next, assume the price feed given to the liquidator has moved such that the sponsors
      // are all now undercollateralized. The liquidator bot should correctly identify this and liquidate the positions.
      // A price of 25 USD per token will make all positions undercollateralized.
      // Numerically debt * price * coltReq > debt for collateralized position.
      // Sponsor1: 12 * 25 * 1.2 > 100
      // Sponsor2: 8 * 25 * 1.2 > 100
      // Sponsor3: 5 * 25 * 1.2 > 100
      priceFeedMock.setCurrentPrice(toBN(toWei("25")));

      await liquidator.queryAndLiquidate(amountToLiquidate);

      // Check logs are emitted correctly. Partial liquidations should emit an "error"-level alert before a normal liquidation "info"-level alert.
      assert.equal(spy.callCount, 5); // 3 info + 2 error level events should be sent at the conclusion of the 3 liquidations including 2 partials.
      assert.equal(spyLogLevel(spy, 4), "info");
      assert.isTrue(spyLogIncludes(spy, 4, "liquidated"));
      assert.equal(spyLogLevel(spy, 3), "info");
      assert.isTrue(spyLogIncludes(spy, 3, "liquidated"));
      assert.equal(spyLogLevel(spy, 2), "error");
      assert.isTrue(spyLogIncludes(spy, 2, "partial liquidation"));
      assert.equal(spyLogLevel(spy, 1), "info");
      assert.isTrue(spyLogIncludes(spy, 1, "liquidated"));
      assert.equal(spyLogLevel(spy, 0), "error");
      assert.isTrue(spyLogIncludes(spy, 0, "partial liquidation"));

      // Sponsor1 should be in a liquidation state with the bot as the liquidator. (6/12) = 50% of the 100 starting collateral and 6 tokens should be liquidated.
      let liquidationObject = (await emp.getLiquidations(sponsor1))[0];
      assert.equal(liquidationObject.sponsor, sponsor1);
      assert.equal(liquidationObject.liquidator, liquidatorBot);
      assert.equal(liquidationObject.state, LiquidationStatesEnum.PRE_DISPUTE);
      assert.equal(liquidationObject.liquidatedCollateral, toWei("50"));
      assert.equal(liquidationObject.tokensOutstanding, toWei("6"));

      // Sponsor2 should be in a liquidation state with the bot as the liquidator. (3/8) = 37.5% of the 100 starting collateral and 3 tokens should be liquidated.
      liquidationObject = (await emp.getLiquidations(sponsor2))[0];
      assert.equal(liquidationObject.sponsor, sponsor2);
      assert.equal(liquidationObject.liquidator, liquidatorBot);
      assert.equal(liquidationObject.state, LiquidationStatesEnum.PRE_DISPUTE);
      assert.equal(liquidationObject.liquidatedCollateral, toWei("37.5"));
      assert.equal(liquidationObject.tokensOutstanding, toWei("3"));

      // Sponsor3 should be in a liquidation state with the bot as the liquidator. (5/5) = 100% of the 100 starting collateral and 5 tokens should be liquidated.
      liquidationObject = (await emp.getLiquidations(sponsor3))[0];
      assert.equal(liquidationObject.sponsor, sponsor3);
      assert.equal(liquidationObject.liquidator, liquidatorBot);
      assert.equal(liquidationObject.state, LiquidationStatesEnum.PRE_DISPUTE);
      assert.equal(liquidationObject.liquidatedCollateral, toWei("100"));
      assert.equal(liquidationObject.tokensOutstanding, toWei("5"));

      // Sponsor1 should have some collateral and tokens left in their position from the liquidation.
      assert.equal((await emp.getCollateral(sponsor1)).rawValue, toWei("50"));
      let positionObject = await emp.positions(sponsor1);
      assert.equal(positionObject.tokensOutstanding.rawValue, toWei("6"));

      // Sponsor2 should have some collateral and tokens left in their position from the liquidation.
      assert.equal((await emp.getCollateral(sponsor2)).rawValue, toWei("62.5"));
      positionObject = await emp.positions(sponsor2);
      assert.equal(positionObject.tokensOutstanding.rawValue, toWei("5"));

      // Sponsor3 should not have a position remaining.
      assert.equal((await emp.getCollateral(sponsor3)).rawValue, 0);
    });

    it("amount-to-liquidate < min-sponsor-tokens", async function() {
      // We'll attempt to liquidate 4 tokens. The minimum sponsor position is 5. There are 3 different scenarios
      // we should test for, each of which we'll attempt to liquidate in one call of `queryAndLiquidate`.
      const amountToLiquidate = toWei("4");

      // 1. (tokens-outstanding - amount-to-liquidate) > min-sponsor-tokens, and amount-to-liquidate < tokens-outstanding.
      //     - The bot will be able to liquidate its desired amount, leaving the position above the minimum token threshold.
      //     - Example: (12 - 4) > 5, new position will have 8 tokens remaining.
      await emp.create({ rawValue: toWei("100") }, { rawValue: toWei("12") }, { from: sponsor1 });
      // 2. (tokens-outstanding - amount-to-liquidate) < min-sponsor-tokens, and amount-to-liquidate < tokens-outstanding.
      //     - The bot will NOT be able to liquidate its desired amount. It will liquidate a reduced amount and
      //       reduce the position exactly to the minimum.
      //     - Example: (8 - 4) <= 5, so instead the bot will liquidate (8 - 5) = 3 tokens to leave the position with (8 - 3) = 5 tokens remaining.
      await emp.create({ rawValue: toWei("100") }, { rawValue: toWei("8") }, { from: sponsor2 });
      // 3. amount-to-liquidate < tokens-outstanding, and amount-to-liquidate < min-sponsor-tokens.
      //     - The bot does not have enough balance to send a full liquidation, and partials are not allowed since 5 >= 5.
      await emp.create({ rawValue: toWei("100") }, { rawValue: toWei("5") }, { from: sponsor3 });

      // liquidatorBot creates a position with enough tokens to liquidate all positions.
      await emp.create({ rawValue: toWei("10000") }, { rawValue: toWei("50") }, { from: liquidatorBot });

      // Next, assume the price feed given to the liquidator has moved such that the sponsors
      // are all now undercollateralized. The liquidator bot should correctly identify this and liquidate the positions.
      // A price of 25 USD per token will make all positions undercollateralized.
      // Numerically debt * price * coltReq > debt for collateralized position.
      // Sponsor1: 12 * 25 * 1.2 > 100
      // Sponsor2: 8 * 25 * 1.2 > 100
      // Sponsor3: 5 * 25 * 1.2 > 100
      priceFeedMock.setCurrentPrice(toBN(toWei("25")));

      await liquidator.queryAndLiquidate(amountToLiquidate);
      assert.equal(spy.callCount, 5); // 2 info + 3 error level events should be sent at the conclusion of the 2 successful, 2 partial, and 1 failed liquidations.
      assert.equal(spy.getCall(-1).lastArg.tokensToLiquidate, "0");

      // Check logs are emitted correctly. Partial liquidations should emit an "error"-level alert before a normal liquidation "info"-level alert.
      assert.equal(spy.callCount, 5); // 2 info + 3 error level events should be sent at the conclusion of the 2 liquidations, including 2 partials, and 1 failed attempt to liquidate 0 tokens.
      assert.equal(spyLogLevel(spy, 4), "error");
      assert.isTrue(spyLogIncludes(spy, 4, "minimum"));
      assert.equal(spyLogLevel(spy, 3), "info");
      assert.isTrue(spyLogIncludes(spy, 3, "liquidated"));
      assert.equal(spyLogLevel(spy, 2), "error");
      assert.isTrue(spyLogIncludes(spy, 2, "partial liquidation"));
      assert.equal(spyLogLevel(spy, 1), "info");
      assert.isTrue(spyLogIncludes(spy, 1, "liquidated"));
      assert.equal(spyLogLevel(spy, 0), "error");
      assert.isTrue(spyLogIncludes(spy, 0, "partial liquidation"));

      // Sponsor1 should be in a liquidation state with the bot as the liquidator. (4/12) = 33.33% of the 100 starting collateral and 6 tokens should be liquidated.
      let liquidationObject = (await emp.getLiquidations(sponsor1))[0];
      assert.equal(liquidationObject.sponsor, sponsor1);
      assert.equal(liquidationObject.liquidator, liquidatorBot);
      assert.equal(liquidationObject.state, LiquidationStatesEnum.PRE_DISPUTE);
      assert.equal(liquidationObject.liquidatedCollateral, toWei("33.3333333333333333"));
      assert.equal(liquidationObject.tokensOutstanding, toWei("4"));

      // Sponsor2 should be in a liquidation state with the bot as the liquidator. (3/8) = 37.5% of the 100 starting collateral and 3 tokens should be liquidated.
      liquidationObject = (await emp.getLiquidations(sponsor2))[0];
      assert.equal(liquidationObject.sponsor, sponsor2);
      assert.equal(liquidationObject.liquidator, liquidatorBot);
      assert.equal(liquidationObject.state, LiquidationStatesEnum.PRE_DISPUTE);
      assert.equal(liquidationObject.liquidatedCollateral, toWei("37.5"));
      assert.equal(liquidationObject.tokensOutstanding, toWei("3"));

      // Sponsor3 should not have been liquidated.

      // Sponsor1 should have some collateral and tokens left in their position from the liquidation.
      assert.equal((await emp.getCollateral(sponsor1)).rawValue, toWei("66.6666666666666667"));
      let positionObject = await emp.positions(sponsor1);
      assert.equal(positionObject.tokensOutstanding.rawValue, toWei("8"));

      // Sponsor2 should have some collateral and tokens left in their position from the liquidation.
      assert.equal((await emp.getCollateral(sponsor2)).rawValue, toWei("62.5"));
      positionObject = await emp.positions(sponsor2);
      assert.equal(positionObject.tokensOutstanding.rawValue, toWei("5"));

      // Sponsor3 should have its full position remaining.
      assert.equal((await emp.getCollateral(sponsor3)).rawValue, toWei("100"));
      positionObject = await emp.positions(sponsor3);
      assert.equal(positionObject.tokensOutstanding.rawValue, toWei("5"));
    });

    it("amount-to-liquidate > min-sponsor-tokens, but bot balance is too low to send liquidation", async function() {
      // We'll attempt to liquidate 10 tokens, but we will only have enough balance to complete the first liquidation.
      const amountToLiquidate = toWei("10");

      await emp.create({ rawValue: toWei("100") }, { rawValue: toWei("12") }, { from: sponsor1 });
      await emp.create({ rawValue: toWei("100") }, { rawValue: toWei("8") }, { from: sponsor2 });

      // liquidatorBot creates a position with enough tokens to liquidate all positions.
      await emp.create({ rawValue: toWei("10000") }, { rawValue: toWei("10") }, { from: liquidatorBot });

      // These positions are both undercollateralized at price of 25: 8 * 25 * 1.2 > 100.
      priceFeedMock.setCurrentPrice(toBN(toWei("25")));

      await liquidator.queryAndLiquidate(amountToLiquidate);
      assert.equal(spy.callCount, 3); // 1 info + 2 error level events should be sent at the conclusion of the 1 successful (incl. 1 partial) and 1 failed liquidations.
      assert.equal(spyLogLevel(spy, 2), "error");
      assert.isTrue(spyLogIncludes(spy, 2, "Failed to liquidate position"));
      assert.equal(spyLogLevel(spy, 1), "info");
      assert.isTrue(spyLogIncludes(spy, 1, "liquidated"));
      assert.equal(spyLogLevel(spy, 0), "error");
      assert.isTrue(spyLogIncludes(spy, 0, "partial liquidation"));

      // Sponsor1 should be in a liquidation state with the bot as the liquidator. (7/12) = 58.33% of the 100 starting collateral and 7 tokens should be liquidated.
      let liquidationObject = (await emp.getLiquidations(sponsor1))[0];
      assert.equal(liquidationObject.sponsor, sponsor1);
      assert.equal(liquidationObject.liquidator, liquidatorBot);
      assert.equal(liquidationObject.state, LiquidationStatesEnum.PRE_DISPUTE);
      assert.equal(liquidationObject.liquidatedCollateral, toWei("58.3333333333333333"));
      assert.equal(liquidationObject.tokensOutstanding, toWei("7"));

      // Sponsor2 should not be in a liquidation state because the bot would have attempted to liquidate its full position of 8 tokens, but it only had remaining.

      // Sponsor1 should have some collateral and tokens left in their position from the liquidation.
      assert.equal((await emp.getCollateral(sponsor1)).rawValue, toWei("41.6666666666666667"));
      let positionObject = await emp.positions(sponsor1);
      assert.equal(positionObject.tokensOutstanding.rawValue, toWei("5"));

      // Sponsor2 should have its full position left
      assert.equal((await emp.getCollateral(sponsor2)).rawValue, toWei("100"));
      positionObject = await emp.positions(sponsor2);
      assert.equal(positionObject.tokensOutstanding.rawValue, toWei("8"));
    });
  });

  describe("Overrides the default liquidator configuration settings", function() {
    it("Cannot set `crThreshold` >= 1", async function() {
      let errorThrown;
      try {
        liquidatorConfig = {
          crThreshold: 1
        };
        liquidator = new Liquidator(
          spyLogger,
          empClient,
          gasEstimator,
          priceFeedMock,
          accounts[0],
          empProps,
          liquidatorConfig
        );
        errorThrown = false;
      } catch (err) {
        errorThrown = true;
      }
      assert.isTrue(errorThrown);
    });

    it("Cannot set `crThreshold` < 0", async function() {
      let errorThrown;
      try {
        liquidatorConfig = {
          crThreshold: -0.02
        };
        liquidator = new Liquidator(
          spyLogger,
          empClient,
          gasEstimator,
          priceFeedMock,
          accounts[0],
          empProps,
          liquidatorConfig
        );
        errorThrown = false;
      } catch (err) {
        errorThrown = true;
      }
      assert.isTrue(errorThrown);
    });

    it("Sets `crThreshold` to 2%", async function() {
      liquidatorConfig = {
        crThreshold: 0.02
      };
      liquidator = new Liquidator(
        spyLogger,
        empClient,
        gasEstimator,
        priceFeedMock,
        accounts[0],
        empProps,
        liquidatorConfig
      );

      // sponsor1 creates a position with 115 units of collateral, creating 100 synthetic tokens.
      await emp.create({ rawValue: toWei("115") }, { rawValue: toWei("100") }, { from: sponsor1 });

      // sponsor2 creates a position with 118 units of collateral, creating 100 synthetic tokens.
      await emp.create({ rawValue: toWei("118") }, { rawValue: toWei("100") }, { from: sponsor2 });

      // liquidatorBot creates a position to have synthetic tokens to pay off debt upon liquidation.
      await emp.create({ rawValue: toWei("1000") }, { rawValue: toWei("500") }, { from: liquidatorBot });

      // Next, assume that the price feed has moved such that both sponsors are technically undercollateralized.
      // However, the price threshold provides just enough buffer for sponsor2 to avoid liquidation.
      // Numerically: (tokens_outstanding * price * coltReq * (1-crThreshold) > debt)
      // must hold for correctly collateralized positions. If the price feed is 1 USD, then
      // there must be more than (100 * 1 * 1.2 * 0.98 = 117.6) collateral in the position.
      // Note that without the price threshold, the minimum collateral would be (100 * 1 * 1.2 = 120), which
      // would make both sponsors undercollateralized. Because of the price threshold setting, the bot should only
      // liquidate sponsor1.
      // Sponsor1: 100 * 1 * 1.2 * 0.98 > 115 [undercollateralized]
      // Sponsor1: 100 * 1 * 1.2 * 0.98 < 118 [sufficiently collateralized]
      // Sponsor2: 100 * 1 * 1.2 > 118 [would be undercollateralized w/o threshold]

      priceFeedMock.setCurrentPrice(toBN(toWei("1")));
      await liquidator.queryAndLiquidate();
      assert.equal(spy.callCount, 1); // 1 info level events should be sent at the conclusion of the 1 liquidation.

      // Sponsor1 should be in a liquidation state with the bot as the liquidator.
      let liquidationObject = (await emp.getLiquidations(sponsor1))[0];
      assert.equal(liquidationObject.sponsor, sponsor1);
      assert.equal(liquidationObject.liquidator, liquidatorBot);
      assert.equal(liquidationObject.state, LiquidationStatesEnum.PRE_DISPUTE);
      assert.equal(liquidationObject.liquidatedCollateral, toWei("115"));

      // Sponsor1 should have zero collateral left in their position from the liquidation.
      assert.equal((await emp.getCollateral(sponsor1)).rawValue, 0);

      // Sponsor2 should have all their collateral left and no liquidations.
      assert.deepStrictEqual(await emp.getLiquidations(sponsor2), []);
      assert.equal((await emp.getCollateral(sponsor2)).rawValue, toWei("118"));
    });
    it("Cannot set invalid alerting overrides", async function() {
      let errorThrown;
      try {
        // Create an invalid log level override. This should be rejected.
        liquidatorConfig = { logOverrides: { positionLiquidated: "not a valid log level" } };
        liquidator = new Liquidator(
          spyLogger,
          empClient,
          gasEstimator,
          priceFeedMock,
          accounts[0],
          empProps,
          liquidatorConfig
        );
        errorThrown = false;
      } catch (err) {
        errorThrown = true;
      }
      assert.isTrue(errorThrown);
    });

    it("Overriding threshold correctly effects generated logs", async function() {
      // Liquidation events normally are `info` level. This override should change the value to `warn` which can be
      // validated after the log is generated.
      liquidatorConfig = { logOverrides: { positionLiquidated: "warn" } };
      liquidator = new Liquidator(
        spyLogger,
        empClient,
        gasEstimator,
        priceFeedMock,
        accounts[0],
        empProps,
        liquidatorConfig
      );

      // sponsor1 creates a position with 115 units of collateral, creating 100 synthetic tokens.
      await emp.create({ rawValue: toWei("115") }, { rawValue: toWei("100") }, { from: sponsor1 });

      // sponsor2 creates a position with 118 units of collateral, creating 100 synthetic tokens.
      await emp.create({ rawValue: toWei("118") }, { rawValue: toWei("100") }, { from: sponsor2 });

      // liquidatorBot creates a position to have synthetic tokens to pay off debt upon liquidation.
      await emp.create({ rawValue: toWei("1000") }, { rawValue: toWei("500") }, { from: liquidatorBot });

      priceFeedMock.setCurrentPrice(toBN(toWei("1")));
      assert.equal(spy.callCount, 0); // No log events before liquidation query
      await liquidator.queryAndLiquidate();
      assert.equal(spy.callCount, 1); // 1 log events after liquidation query.
      assert.equal(lastSpyLogLevel(spy), "warn"); // most recent log level should be "warn"
    });
  });
});
