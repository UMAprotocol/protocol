const { toWei, toBN, utf8ToHex, padRight } = web3.utils;
const winston = require("winston");
const sinon = require("sinon");
const {
  parseFixed,
  interfaceName,
  LiquidationStatesEnum,
  PostWithdrawLiquidationRewardsStatusTranslations,
  ZERO_ADDRESS
} = require("@uma/common");

// Script to test
const { Liquidator } = require("../src/liquidator.js");

// Helper clients and custom winston transport module to monitor winston log outputs
const {
  ExpiringMultiPartyClient,
  GasEstimator,
  PriceFeedMock,
  SpyTransport,
  lastSpyLogLevel,
  spyLogIncludes,
  spyLogLevel
} = require("@uma/financial-templates-lib");

// Contracts and helpers
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const Finder = artifacts.require("Finder");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const MockOracle = artifacts.require("MockOracle");
const Token = artifacts.require("ExpandedERC20");
const SyntheticToken = artifacts.require("SyntheticToken");
const Timer = artifacts.require("Timer");
const Store = artifacts.require("Store");

// Run the tests against 3 different kinds of token/synth decimal combinations:
// 1) matching 18 & 18 for collateral for most token types with normal tokens.
// 2) non-matching 8 collateral & 18 synthetic for legacy UMA synthetics.
// 3) matching 8 collateral & 8 synthetic for current UMA synthetics.
const configs = [
  {
    tokenName: "Wrapped Ether",
    tokenSymbol: "WETH",
    collateralDecimals: 18,
    syntheticDecimals: 18,
    priceFeedDecimals: 18
  },
  {
    tokenName: "Legacy Wrapped Bitcoin",
    tokenSymbol: "BTC",
    collateralDecimals: 8,
    syntheticDecimals: 18,
    priceFeedDecimals: 8
  },
  {
    tokenName: "Wrapped Bitcoin",
    tokenSymbol: "BTC",
    collateralDecimals: 8,
    syntheticDecimals: 8,
    priceFeedDecimals: 18
  }
];
// allows this to be set to null without throwing.
const Convert = decimals => number => (number ? parseFixed(number.toString(), decimals).toString() : number);

contract("Liquidator.js", function(accounts) {
  for (let testConfig of configs) {
    describe(`${testConfig.collateralDecimals} collateral, ${testConfig.syntheticDecimals} synthetic & ${testConfig.priceFeedDecimals} pricefeed decimals`, function() {
      // Implementation uses the 0th address by default as the bot runs using the default truffle wallet accounts[0].
      const liquidatorBot = accounts[0];
      const sponsor1 = accounts[1];
      const sponsor2 = accounts[2];
      const sponsor3 = accounts[3];
      const contractCreator = accounts[4];
      const liquidityProvider = accounts[5];

      let store;
      let finder;
      let collateralToken;
      let emp;
      let liquidator;
      let syntheticToken;
      let mockOracle;
      let priceFeedMock;
      let timer;

      let spy;
      let spyLogger;

      let gasEstimator;
      let empClient;
      let liquidatorConfig;
      let liquidatorOverridePrice;
      let empProps;

      let identifier;
      let convertCollateral;
      let convertSynthetic;
      let convertPrice;

      before(async function() {
        identifier = `${testConfig.tokenName}TEST`;
        convertCollateral = Convert(testConfig.collateralDecimals);
        convertSynthetic = Convert(testConfig.syntheticDecimals);
        convertPrice = Convert(testConfig.priceFeedDecimals);
        collateralToken = await Token.new(testConfig.tokenName, testConfig.tokenSymbol, testConfig.collateralDecimals, {
          from: contractCreator
        });
        await collateralToken.addMember(1, contractCreator, {
          from: contractCreator
        });

        // Seed the sponsors accounts.
        // 10 btc
        await collateralToken.mint(sponsor1, convertCollateral("100000"), { from: contractCreator });
        await collateralToken.mint(sponsor2, convertCollateral("100000"), { from: contractCreator });
        await collateralToken.mint(sponsor3, convertCollateral("100000"), { from: contractCreator });
        await collateralToken.mint(liquidityProvider, convertCollateral("1000000"), { from: contractCreator });

        // seed the liquidatorBot's wallet so it can perform liquidations.
        await collateralToken.mint(liquidatorBot, convertCollateral("100000"), { from: contractCreator });

        // Create identifier whitelist and register the price tracking ticker with it.
        const identifierWhitelist = await IdentifierWhitelist.new();
        await identifierWhitelist.addSupportedIdentifier(utf8ToHex(identifier));

        finder = await Finder.new();
        timer = await Timer.new();
        store = await Store.new({ rawValue: "0" }, { rawValue: "0" }, timer.address);
        await finder.changeImplementationAddress(utf8ToHex(interfaceName.Store), store.address);

        await finder.changeImplementationAddress(
          web3.utils.utf8ToHex(interfaceName.IdentifierWhitelist),
          identifierWhitelist.address
        );
      });

      beforeEach(async function() {
        mockOracle = await MockOracle.new(finder.address, timer.address, {
          from: contractCreator
        });
        await finder.changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.address);

        // Create a new synthetic token
        syntheticToken = await SyntheticToken.new("Test Synthetic Token", "SYNTH", testConfig.syntheticDecimals);

        const constructorParams = {
          expirationTimestamp: (await timer.getCurrentTime()).toNumber() + 100000,
          withdrawalLiveness: "1000",
          collateralAddress: collateralToken.address,
          tokenAddress: syntheticToken.address,
          finderAddress: finder.address,
          priceFeedIdentifier: padRight(utf8ToHex(identifier), 64),
          liquidationLiveness: "1000",
          collateralRequirement: { rawValue: toWei("1.2") },
          disputeBondPct: { rawValue: toWei("0.1") },
          sponsorDisputeRewardPct: { rawValue: toWei("0.1") },
          disputerDisputeRewardPct: { rawValue: toWei("0.1") },
          minSponsorTokens: { rawValue: convertSynthetic("5") },
          timerAddress: timer.address,
          excessTokenBeneficiary: store.address,
          financialProductLibraryAddress: ZERO_ADDRESS
        };
        // Deploy a new expiring multi party
        emp = await ExpiringMultiParty.new(constructorParams);
        await syntheticToken.addMinter(emp.address);
        await syntheticToken.addBurner(emp.address);

        await collateralToken.approve(emp.address, convertCollateral("10000000"), { from: sponsor1 });
        await collateralToken.approve(emp.address, convertCollateral("10000000"), { from: sponsor2 });
        await collateralToken.approve(emp.address, convertCollateral("10000000"), { from: sponsor3 });
        await collateralToken.approve(emp.address, convertCollateral("100000000"), { from: liquidatorBot });
        await collateralToken.approve(emp.address, convertCollateral("100000000"), { from: liquidityProvider });

        syntheticToken = await Token.at(await emp.tokenCurrency());
        await syntheticToken.approve(emp.address, convertSynthetic("100000000"), { from: sponsor1 });
        await syntheticToken.approve(emp.address, convertSynthetic("100000000"), { from: sponsor2 });
        await syntheticToken.approve(emp.address, convertSynthetic("100000000"), { from: sponsor3 });
        await syntheticToken.approve(emp.address, convertSynthetic("100000000"), { from: liquidatorBot });
        await syntheticToken.approve(emp.address, convertSynthetic("100000000"), { from: liquidityProvider });

        spy = sinon.spy();

        spyLogger = winston.createLogger({
          level: "info",
          transports: [new SpyTransport({ level: "info" }, { spy: spy })]
        });

        // Create a new instance of the ExpiringMultiPartyClient & gasEstimator to construct the liquidator
        empClient = new ExpiringMultiPartyClient(
          spyLogger,
          ExpiringMultiParty.abi,
          web3,
          emp.address,
          testConfig.collateralDecimals,
          testConfig.syntheticDecimals,
          testConfig.priceFeedDecimals
        );
        gasEstimator = new GasEstimator(spyLogger);

        // Create a new instance of the price feed mock.
        priceFeedMock = new PriceFeedMock(undefined, undefined, undefined, testConfig.priceFeedDecimals);

        // Create a new instance of the liquidator to test
        liquidatorConfig = {
          crThreshold: 0
        };

        // Generate EMP properties to inform bot of important on-chain state values that we only want to query once.
        empProps = {
          crRatio: await emp.collateralRequirement(),
          priceIdentifier: await emp.priceIdentifier(),
          minSponsorSize: await emp.minSponsorTokens(),
          withdrawLiveness: await emp.withdrawalLiveness()
        };

        liquidator = new Liquidator({
          logger: spyLogger,
          expiringMultiPartyClient: empClient,
          gasEstimator,
          votingContract: mockOracle.contract,
          syntheticToken: syntheticToken.contract,
          priceFeed: priceFeedMock,
          account: accounts[0],
          empProps,
          config: liquidatorConfig
        });
      });
      it("Can correctly detect undercollateralized positions and liquidate them", async function() {
        // sponsor1 creates a position with 125 units of collateral, creating 100 synthetic tokens.
        await emp.create(
          { rawValue: convertCollateral("125") },
          { rawValue: convertSynthetic("100") },
          { from: sponsor1 }
        );

        // sponsor2 creates a position with 150 units of collateral, creating 100 synthetic tokens.
        await emp.create(
          { rawValue: convertCollateral("150") },
          { rawValue: convertSynthetic("100") },
          { from: sponsor2 }
        );

        // sponsor3 creates a position with 175 units of collateral, creating 100 synthetic tokens.
        await emp.create(
          { rawValue: convertCollateral("175") },
          { rawValue: convertSynthetic("100") },
          { from: sponsor3 }
        );

        // liquidatorBot creates a position to have synthetic tokens to pay off debt upon liquidation.
        await emp.create(
          { rawValue: convertCollateral("1000") },
          { rawValue: convertSynthetic("500") },
          { from: liquidatorBot }
        );

        // Start with a mocked price of 1 usd per token.
        // This puts both sponsors over collateralized so no liquidations should occur.
        priceFeedMock.setCurrentPrice(convertPrice("1"));

        await liquidator.update();
        await liquidator.liquidatePositions();
        assert.equal(spy.callCount, 0); // No info level logs should be sent.

        // Both token sponsors should still have their positions with full collateral.
        assert.equal((await emp.getCollateral(sponsor1)).rawValue, convertCollateral("125"));
        assert.equal((await emp.getCollateral(sponsor2)).rawValue, convertCollateral("150"));

        // Liquidator throws an error if the price feed returns an invalid value.
        priceFeedMock.setCurrentPrice(convertPrice(null));
        await liquidator.update();
        let errorThrown = false;
        try {
          await liquidator.liquidatePositions();
        } catch (error) {
          errorThrown = true;
        }
        assert.isTrue(errorThrown);

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

        priceFeedMock.setCurrentPrice(convertPrice("1.3"));
        await liquidator.update();
        await liquidator.liquidatePositions();
        // assert.equal(spy.callCount, 2); // 2 info level events should be sent at the conclusion of the 2 liquidations.

        // Sponsor1 should be in a liquidation state with the bot as the liquidator.
        let liquidationObject = (await emp.getLiquidations(sponsor1))[0];
        assert.equal(liquidationObject.sponsor, sponsor1);
        assert.equal(liquidationObject.liquidator, liquidatorBot);
        assert.equal(liquidationObject.state, LiquidationStatesEnum.PRE_DISPUTE);
        assert.equal(liquidationObject.liquidatedCollateral, convertCollateral("125"));

        // Sponsor1 should have zero collateral left in their position from the liquidation.
        assert.equal((await emp.getCollateral(sponsor1)).rawValue, 0);

        // Sponsor2 should be in a liquidation state with the bot as the liquidator.
        liquidationObject = (await emp.getLiquidations(sponsor2))[0];
        assert.equal(liquidationObject.sponsor, sponsor2);
        assert.equal(liquidationObject.liquidator, liquidatorBot);
        assert.equal(liquidationObject.state, LiquidationStatesEnum.PRE_DISPUTE);
        assert.equal(liquidationObject.liquidatedCollateral, convertCollateral("150"));

        // Sponsor2 should have zero collateral left in their position from the liquidation.
        assert.equal((await emp.getCollateral(sponsor2)).rawValue, 0);

        // Sponsor3 should have all their collateral left and no liquidations.
        assert.deepStrictEqual(await emp.getLiquidations(sponsor3), []);
        assert.equal((await emp.getCollateral(sponsor3)).rawValue, convertCollateral("175"));

        // Another query at the same price should execute no new liquidations.
        priceFeedMock.setCurrentPrice(convertPrice("1.3"));
        await liquidator.update();
        await liquidator.liquidatePositions();
        assert.equal(spy.callCount, 2);
      });

      it("Can correctly detect invalid withdrawals and liquidate them", async function() {
        // sponsor1 creates a position with 125 units of collateral, creating 100 synthetic tokens.
        await emp.create(
          { rawValue: convertCollateral("125") },
          { rawValue: convertSynthetic("100") },
          { from: sponsor1 }
        );

        // sponsor2 creates a position with 150 units of collateral, creating 100 synthetic tokens.
        await emp.create(
          { rawValue: convertCollateral("150") },
          { rawValue: convertSynthetic("100") },
          { from: sponsor2 }
        );

        // liquidatorBot creates a position to have synthetic tokens to pay off debt upon liquidation.
        await emp.create(
          { rawValue: convertCollateral("1000") },
          { rawValue: convertSynthetic("500") },
          { from: liquidatorBot }
        );

        // Start with a mocked price of 1 usd per token.
        // This puts both sponsors over collateralized so no liquidations should occur.
        priceFeedMock.setCurrentPrice(convertPrice("1"));
        await liquidator.update();
        await liquidator.liquidatePositions();
        assert.equal(spy.callCount, 0); // No info level logs should be sent.

        // There should be no liquidations created from any sponsor account
        assert.deepStrictEqual(await emp.getLiquidations(sponsor1), []);
        assert.deepStrictEqual(await emp.getLiquidations(sponsor2), []);

        // Both token sponsors should still have their positions with full collateral.
        assert.equal((await emp.getCollateral(sponsor1)).rawValue, convertCollateral("125"));
        assert.equal((await emp.getCollateral(sponsor2)).rawValue, convertCollateral("150"));

        // If sponsor1 requests a withdrawal of any amount of collateral above 5 units at the given price of 1 usd per token
        // their remaining position becomes undercollateralized. Say they request to withdraw 10 units of collateral.
        // This places their position with a CR of: 115 / (100 * 1) * 100 = 115%. This is below the CR threshold.
        await emp.requestWithdrawal({ rawValue: convertCollateral("10") }, { from: sponsor1 });

        priceFeedMock.setCurrentPrice(convertPrice("1"));
        await liquidator.update();
        await liquidator.liquidatePositions();
        assert.equal(spy.callCount, 1); // There should be one log from the liquidation event of the withdrawal.

        // There should be exactly one liquidation in sponsor1's account. The liquidated collateral should be the original
        // amount of collateral minus the collateral withdrawn. 125 - 10 = 115
        let liquidationObject = (await emp.getLiquidations(sponsor1))[0];
        assert.equal(liquidationObject.sponsor, sponsor1);
        assert.equal(liquidationObject.liquidator, liquidatorBot);
        assert.equal(liquidationObject.state, LiquidationStatesEnum.PRE_DISPUTE);
        assert.equal(liquidationObject.liquidatedCollateral, convertCollateral("115"));
        assert.equal(liquidationObject.lockedCollateral, convertCollateral("125"));

        // Advance the timer to the liquidation expiry.
        const liquidationTime = liquidationObject.liquidationTime;
        const liquidationLiveness = 1000;
        await emp.setCurrentTime(Number(liquidationTime) + liquidationLiveness);

        // Now that the liquidation has expired, the liquidator can withdraw rewards.
        const collateralPreWithdraw = await collateralToken.balanceOf(liquidatorBot);
        await liquidator.update();
        await liquidator.withdrawRewards();
        assert.equal(spy.callCount, 2); // 1 new info level events should be sent at the conclusion of the withdrawal. total 2.

        // Liquidator should have their collateral increased by Sponsor1's collateral.
        const collateralPostWithdraw = await collateralToken.balanceOf(liquidatorBot);
        assert.equal(
          toBN(collateralPreWithdraw)
            .add(toBN(convertCollateral("125")))
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
        await emp.create(
          { rawValue: convertCollateral("125") },
          { rawValue: convertSynthetic("100") },
          { from: sponsor1 }
        );

        // liquidatorBot creates a position to have synthetic tokens to pay off debt upon liquidation.
        await emp.create(
          { rawValue: convertCollateral("1000") },
          { rawValue: convertSynthetic("500") },
          { from: liquidatorBot }
        );

        // Next, the liquidator believes the price to be 1.3, which would make the position undercollateralized,
        // and liquidates the position.
        // Sponsor1: 100 * 1.3 * 1.2 > 125 [undercollateralized]
        priceFeedMock.setCurrentPrice(convertPrice("1.3"));
        await liquidator.update();
        await liquidator.liquidatePositions();
        assert.equal(spy.callCount, 1); // 1 info level events should be sent at the conclusion of the liquidation.

        // Advance the timer to the liquidation expiry.
        const liquidationTime = (await emp.getLiquidations(sponsor1))[0].liquidationTime;
        const liquidationLiveness = 1000;
        await emp.setCurrentTime(Number(liquidationTime) + liquidationLiveness);

        // Now that the liquidation has expired, the liquidator can withdraw rewards.
        const collateralPreWithdraw = await collateralToken.balanceOf(liquidatorBot);
        await liquidator.update();
        await liquidator.withdrawRewards();
        assert.equal(spy.callCount, 2); // 1 new info level events should be sent at the conclusion of the withdrawal. Total 2.

        // Liquidator should have their collateral increased by Sponsor1's collateral.
        const collateralPostWithdraw = await collateralToken.balanceOf(liquidatorBot);
        assert.equal(
          toBN(collateralPreWithdraw)
            .add(toBN(convertCollateral("125")))
            .toString(),
          collateralPostWithdraw.toString()
        );

        // Liquidation data should have been deleted.
        assert.deepStrictEqual((await emp.getLiquidations(sponsor1))[0].state, LiquidationStatesEnum.UNINITIALIZED);
      });

      it("Can withdraw rewards from liquidations that were disputed unsuccessfully", async function() {
        // sponsor1 creates a position with 125 units of collateral, creating 100 synthetic tokens.
        await emp.create(
          { rawValue: convertCollateral("125") },
          { rawValue: convertSynthetic("100") },
          { from: sponsor1 }
        );

        // liquidatorBot creates a position to have synthetic tokens to pay off debt upon liquidation.
        await emp.create(
          { rawValue: convertCollateral("1000") },
          { rawValue: convertSynthetic("500") },
          { from: liquidatorBot }
        );

        // Next, the liquidator believes the price to be 1.3, which would make the position undercollateralized,
        // and liquidates the position.
        // Sponsor1: 100 * 1.3 * 1.2 > 125 [undercollateralized]
        priceFeedMock.setCurrentPrice(convertPrice("1.3"));
        await liquidator.update();
        await liquidator.liquidatePositions();
        assert.equal(spy.callCount, 1); // 1 info level events should be sent at the conclusion of the liquidation.

        // Dispute the liquidation, which requires staking a dispute bond.
        await emp.dispute("0", sponsor1, { from: sponsor3 });

        // Attempt to withdraw before dispute resolves should do nothing exit gracefully.
        await liquidator.update();
        await liquidator.withdrawRewards();
        assert.equal(spy.callCount, 1); // no new info level events as too early.

        // Simulate a failed dispute by pushing a price to the oracle, at the time of the liquidation request, such that
        // the position was truly undercollateralized. In other words, the liquidator was liquidating at the correct price.
        const disputePrice = convertPrice("1.3");
        const liquidationTime = (await emp.getLiquidations(sponsor1))[0].liquidationTime;
        await mockOracle.pushPrice(utf8ToHex(`${testConfig.tokenName}TEST`), liquidationTime, disputePrice);

        // The liquidator can now settle the dispute by calling `withdrawRewards()` because the oracle has a price
        // for the liquidation time.
        const collateralPreWithdraw = await collateralToken.balanceOf(liquidatorBot);
        await liquidator.update();
        await liquidator.withdrawRewards();
        assert.equal(spy.callCount, 2); // 1 new info level event should be sent due to the withdrawal.

        // Liquidator should have their collateral increased by Sponsor1's collateral + the disputer's dispute bond:
        // 125 + (10% of 125) = 137.5 units of collateral.
        const collateralPostWithdraw = await collateralToken.balanceOf(liquidatorBot);
        assert.equal(
          toBN(collateralPreWithdraw)
            .add(toBN(convertCollateral("137.5")))
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
        assert.equal(spy.getCall(-1).lastArg.liquidationResult.resolvedPrice, convertPrice("1.3"));

        // After the dispute is resolved, the liquidation should no longer exist and there should be no disputes to withdraw rewards from.
        await liquidator.update();
        await liquidator.withdrawRewards();
        assert.equal(spy.callCount, 2);
      });

      it("Can withdraw rewards from liquidations that were disputed successfully", async function() {
        // sponsor1 creates a position with 125 units of collateral, creating 100 synthetic tokens.
        await emp.create(
          { rawValue: convertCollateral("125") },
          { rawValue: convertSynthetic("100") },
          { from: sponsor1 }
        );

        // liquidatorBot creates a position to have synthetic tokens to pay off debt upon liquidation.
        await emp.create(
          { rawValue: convertCollateral("1000") },
          { rawValue: convertSynthetic("500") },
          { from: liquidatorBot }
        );

        // Next, the liquidator believes the price to be 1.3, which would make the position undercollateralized,
        // and liquidates the position.
        // Sponsor1: 100 * 1.3 * 1.2 > 125 [undercollateralized]
        priceFeedMock.setCurrentPrice(convertPrice("1.3"));
        await liquidator.update();
        await liquidator.liquidatePositions();
        assert.equal(spy.callCount, 1); // 1 info level events should be sent at the conclusion of the liquidation.

        // Dispute the liquidation, which requires staking a dispute bond.
        await emp.dispute("0", sponsor1, { from: sponsor3 });

        // Attempt to withdraw before dispute resolves should do nothing exit gracefully.
        await liquidator.update();
        await liquidator.withdrawRewards();
        assert.equal(spy.callCount, 1); // no new info level events as too early.

        // Simulate a successful dispute by pushing a price to the oracle, at the time of the liquidation request, such that
        // the position was not undercollateralized. In other words, the liquidator was liquidating at the incorrect price.
        const disputePrice = convertPrice("1");
        const liquidationTime = (await emp.getLiquidations(sponsor1))[0].liquidationTime;
        await mockOracle.pushPrice(utf8ToHex(identifier), liquidationTime, disputePrice);

        // The liquidator can now settle the dispute by calling `withdrawRewards()` because the oracle has a price
        // for the liquidation time.
        const collateralPreWithdraw = await collateralToken.balanceOf(liquidatorBot);
        await liquidator.update();
        await liquidator.withdrawRewards();
        assert.equal(spy.callCount, 2); // 1 new info level event should be sent due to the withdrawal.

        // Liquidator should have their collateral increased by TRV - (disputer and sponsor rewards):
        // 100 - 2 * (10% of 100) = 80 units of collateral.
        const collateralPostWithdraw = await collateralToken.balanceOf(liquidatorBot);
        assert.equal(
          toBN(collateralPreWithdraw)
            .add(toBN(convertCollateral("80")))
            .toString(),
          collateralPostWithdraw.toString()
        );

        // Check that the log includes a human readable translation of the liquidation status, and the dispute price.
        assert.equal(
          spy.getCall(-1).lastArg.liquidationResult.liquidationStatus,
          PostWithdrawLiquidationRewardsStatusTranslations[LiquidationStatesEnum.DISPUTE_SUCCEEDED]
        );
        assert.equal(spy.getCall(-1).lastArg.liquidationResult.resolvedPrice, convertPrice("1"));

        // After the dispute is resolved, the liquidation should still exist but the liquidator should no longer be able to withdraw any rewards.
        await liquidator.update();
        await liquidator.withdrawRewards();
        assert.equal(spy.callCount, 2);
      });

      it("Detect if the liquidator cannot liquidate due to capital constraints", async function() {
        // sponsor1 creates a position with 125 units of collateral, creating 100 synthetic tokens.
        await emp.create(
          { rawValue: convertCollateral("125") },
          { rawValue: convertSynthetic("100") },
          { from: sponsor1 }
        );

        // Next, the liquidator believes the price to be 1.3, which would make the position undercollateralized,
        // and liquidates the position.
        // Sponsor1: 100 * 1.3 * 1.2 > 125 [undercollateralized]
        priceFeedMock.setCurrentPrice(convertPrice("1.3"));

        // No transaction should be sent, so this should not throw.
        await liquidator.update();
        await liquidator.liquidatePositions();
        assert.equal(spy.callCount, 1); // 1 new error level event due to the failed liquidation.

        // No liquidations should have gone through.
        assert.equal((await emp.getLiquidations(sponsor1)).length, 0);

        // liquidatorBot creates a position to have synthetic tokens to pay off debt upon liquidation.
        await emp.create(
          { rawValue: convertCollateral("1000") },
          { rawValue: convertSynthetic("500") },
          { from: liquidatorBot }
        );
        // No need to force update the `empClient` here since we are not interested in detecting the `liquidatorBot`'s new
        // position, but now when we try to liquidate the position the liquidation will go through because the bot will have
        // the requisite balance.

        // Can now liquidate the position.
        priceFeedMock.setCurrentPrice(convertPrice("1.3"));
        await liquidator.update();
        await liquidator.liquidatePositions();
        assert.equal(spy.callCount, 2); // 1 new info level event due to the successful liquidation.

        // The liquidation should have gone through.
        assert.equal((await emp.getLiquidations(sponsor1)).length, 1);
        assert.equal(spy.callCount, 2); // 1 new log level event due to the successful execution.
      });

      describe("Overrides the default liquidator configuration settings", function() {
        it("Cannot set `crThreshold` >= 1", async function() {
          let errorThrown;
          try {
            liquidatorConfig = {
              crThreshold: 1
            };
            liquidator = new Liquidator({
              logger: spyLogger,
              expiringMultiPartyClient: empClient,
              gasEstimator,
              votingContract: mockOracle.contract,
              syntheticToken: syntheticToken.contract,
              priceFeed: priceFeedMock,
              account: accounts[0],
              empProps,
              config: liquidatorConfig
            });
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
            liquidator = new Liquidator({
              logger: spyLogger,
              expiringMultiPartyClient: empClient,
              gasEstimator,
              votingContract: mockOracle.contract,
              syntheticToken: syntheticToken.contract,
              priceFeed: priceFeedMock,
              account: accounts[0],
              empProps,
              config: liquidatorConfig
            });
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
          liquidator = new Liquidator({
            logger: spyLogger,
            expiringMultiPartyClient: empClient,
            gasEstimator,
            votingContract: mockOracle.contract,
            syntheticToken: syntheticToken.contract,
            priceFeed: priceFeedMock,
            account: accounts[0],
            empProps,
            config: liquidatorConfig
          });

          // sponsor1 creates a position with 115 units of collateral, creating 100 synthetic tokens.
          await emp.create(
            { rawValue: convertCollateral("115") },
            { rawValue: convertSynthetic("100") },
            { from: sponsor1 }
          );

          // sponsor2 creates a position with 118 units of collateral, creating 100 synthetic tokens.
          await emp.create(
            { rawValue: convertCollateral("118") },
            { rawValue: convertSynthetic("100") },
            { from: sponsor2 }
          );

          // liquidatorBot creates a position to have synthetic tokens to pay off debt upon liquidation.
          await emp.create(
            { rawValue: convertCollateral("1000") },
            { rawValue: convertSynthetic("500") },
            { from: liquidatorBot }
          );

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

          priceFeedMock.setCurrentPrice(convertPrice("1"));
          await liquidator.update();
          await liquidator.liquidatePositions();
          assert.equal(spy.callCount, 1); // 1 info level events should be sent at the conclusion of the 1 liquidation.

          // Sponsor1 should be in a liquidation state with the bot as the liquidator.
          let liquidationObject = (await emp.getLiquidations(sponsor1))[0];
          assert.equal(liquidationObject.sponsor, sponsor1);
          assert.equal(liquidationObject.liquidator, liquidatorBot);
          assert.equal(liquidationObject.state, LiquidationStatesEnum.PRE_DISPUTE);
          assert.equal(liquidationObject.liquidatedCollateral, convertCollateral("115"));

          // Sponsor1 should have zero collateral left in their position from the liquidation.
          assert.equal((await emp.getCollateral(sponsor1)).rawValue, 0);

          // Sponsor2 should have all their collateral left and no liquidations.
          assert.deepStrictEqual(await emp.getLiquidations(sponsor2), []);
          assert.equal((await emp.getCollateral(sponsor2)).rawValue, convertCollateral("118"));
        });
        it("Cannot set invalid alerting overrides", async function() {
          let errorThrown;
          try {
            // Create an invalid log level override. This should be rejected.
            liquidatorConfig = { logOverrides: { positionLiquidated: "not a valid log level" } };
            liquidator = new Liquidator({
              logger: spyLogger,
              expiringMultiPartyClient: empClient,
              gasEstimator,
              votingContract: mockOracle.contract,
              syntheticToken: syntheticToken.contract,
              priceFeed: priceFeedMock,
              account: accounts[0],
              empProps,
              config: liquidatorConfig
            });
            errorThrown = false;
          } catch (err) {
            errorThrown = true;
          }
          assert.isTrue(errorThrown);
        });
        it("amount-to-liquidate > min-sponsor-tokens, but bot balance is too low to send liquidation", async function() {
          // We'll attempt to liquidate 10 tokens, but we will only have enough balance to complete the first liquidation.
          const amountToLiquidate = toWei("10");

          await emp.create(
            { rawValue: convertCollateral("100") },
            { rawValue: convertSynthetic("12") },
            { from: sponsor1 }
          );
          await emp.create(
            { rawValue: convertCollateral("100") },
            { rawValue: convertSynthetic("8") },
            { from: sponsor2 }
          );

          // liquidatorBot creates a position with enough tokens to liquidate all positions.
          await emp.create(
            { rawValue: convertCollateral("10000") },
            { rawValue: convertSynthetic("10") },
            { from: liquidatorBot }
          );

          // These positions are both undercollateralized at price of 25: 8 * 25 * 1.2 > 100.
          priceFeedMock.setCurrentPrice(convertPrice("25"));

          await liquidator.update();
          await liquidator.liquidatePositions(amountToLiquidate);

          // 2 partial liquidations. This behavior has changed slightly from previous test
          // as the liquidation amount calculator is slightly improved. Previous calculation
          // did not take into account current bot balance correctly and overestimated liquidation
          // amount causing an error.
          assert.equal(spy.callCount, 4);
          assert.equal(spyLogLevel(spy, 3), "info");
          assert.isTrue(spyLogIncludes(spy, 3, "liquidated"));
          assert.equal(spyLogLevel(spy, 2), "error");
          assert.isTrue(spyLogIncludes(spy, 2, "partial liquidation"));
          assert.equal(spyLogLevel(spy, 1), "info");
          assert.isTrue(spyLogIncludes(spy, 1, "liquidated"));
          assert.equal(spyLogLevel(spy, 0), "error");
          assert.isTrue(spyLogIncludes(spy, 0, "partial liquidation"));

          // Sponsor1 should be in a liquidation state with the bot as the liquidator. (7/12) = 58.33% of the 100 starting collateral and 7 tokens should be liquidated.
          let liquidationObject = (await emp.getLiquidations(sponsor1))[0];
          assert.equal(liquidationObject.sponsor, sponsor1);
          assert.equal(liquidationObject.liquidator, liquidatorBot);
          assert.equal(liquidationObject.state, LiquidationStatesEnum.PRE_DISPUTE);
          if (testConfig.collateralDecimals == 18) {
            assert.equal(liquidationObject.liquidatedCollateral.rawValue, convertCollateral("58.3333333333333333"));
          } else if (testConfig.collateralDecimals == 8) {
            assert.equal(liquidationObject.liquidatedCollateral.rawValue, convertCollateral("58.33333333"));
          }
          assert.equal(liquidationObject.tokensOutstanding.rawValue, convertSynthetic("7"));

          // Sponsor2 should not be in a liquidation state because the bot would have attempted to liquidate its full position of 8 tokens, but it only had remaining.

          // Sponsor1 should have some collateral and tokens left in their position from the liquidation.
          if (testConfig.collateralDecimals == 18) {
            assert.equal((await emp.getCollateral(sponsor1)).rawValue, convertCollateral("41.6666666666666667"));
          } else if (testConfig.collateralDecimals == 8) {
            assert.equal((await emp.getCollateral(sponsor1)).rawValue, convertCollateral("41.66666667"));
          }
          let positionObject = await emp.positions(sponsor1);
          assert.equal(positionObject.tokensOutstanding.rawValue, convertSynthetic("5"));

          // Sponsor2 should not have its full position left, it was partially liquidated
          // Bot has 3 tokens left after first liquidation, and this brings position
          // to just at the min sponsor size of 5.
          // (8-3)/8 = 5/8, 5/8 * 100 = 62.5
          assert.equal((await emp.getCollateral(sponsor2)).rawValue, convertCollateral("62.5"));
          positionObject = await emp.positions(sponsor2);
          assert.equal(positionObject.tokensOutstanding.rawValue, convertSynthetic("5"));
        });
        describe("Partial liquidations", function() {
          it("amount-to-liquidate > min-sponsor-tokens", async function() {
            // We'll attempt to liquidate 6 tokens. The minimum sponsor position is 5. There are 3 different scenarios
            // we should test for, each of which we'll attempt to liquidate in one call of `liquidatePositions`.
            const amountToLiquidate = convertSynthetic("6");

            // 1. (tokens-outstanding - amount-to-liquidate) > min-sponsor-tokens, and amount-to-liquidate < tokens-outstanding
            //     - The bot will be able to liquidate its desired amount, leaving the position above the minimum token threshold.
            //     - Example: (12 - 6) > 5, new position will have 6 tokens remaining.
            await emp.create(
              { rawValue: convertCollateral("100") },
              { rawValue: convertSynthetic("12") },
              { from: sponsor1 }
            );
            // 2. (tokens-outstanding - amount-to-liquidate) <= min-sponsor-tokens, and amount-to-liquidate < tokens-outstanding
            //     - The bot will NOT be able to liquidate its desired amount. It will liquidate a reduced amount and
            //       reduce the position exactly to the minimum.
            //     - Example: (8 - 6) <= 5, so instead the bot will liquidate (8 - 5) = 3 tokens to leave the position with (8 - 3) = 5 tokens remaining.
            await emp.create(
              { rawValue: convertCollateral("100") },
              { rawValue: convertSynthetic("8") },
              { from: sponsor2 }
            );
            // 3. amount-to-liquidate > tokens-outstanding
            //     - The bot will liquidate the full position.
            //     - Example: 6 > 5, so the bot will liquidate 5 tokens.
            await emp.create(
              { rawValue: convertCollateral("100") },
              { rawValue: convertSynthetic("5") },
              { from: sponsor3 }
            );

            // liquidatorBot creates a position with enough tokens to liquidate all positions.
            await emp.create(
              { rawValue: convertCollateral("10000") },
              { rawValue: convertSynthetic("50") },
              { from: liquidatorBot }
            );

            // Next, assume the price feed given to the liquidator has moved such that the sponsors
            // are all now undercollateralized. The liquidator bot should correctly identify this and liquidate the positions.
            // A price of 25 USD per token will make all positions undercollateralized.
            // Numerically debt * price * coltReq > debt for collateralized position.
            // Sponsor1: 12 * 25 * 1.2 > 100
            // Sponsor2: 8 * 25 * 1.2 > 100
            // Sponsor3: 5 * 25 * 1.2 > 100
            priceFeedMock.setCurrentPrice(convertPrice("25"));

            await liquidator.update();
            await liquidator.liquidatePositions(amountToLiquidate);

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
            assert.equal(liquidationObject.liquidatedCollateral, convertCollateral("50"));
            assert.equal(liquidationObject.tokensOutstanding, convertSynthetic("6"));

            // Sponsor2 should be in a liquidation state with the bot as the liquidator. (3/8) = 37.5% of the 100 starting collateral and 3 tokens should be liquidated.
            liquidationObject = (await emp.getLiquidations(sponsor2))[0];
            assert.equal(liquidationObject.sponsor, sponsor2);
            assert.equal(liquidationObject.liquidator, liquidatorBot);
            assert.equal(liquidationObject.state, LiquidationStatesEnum.PRE_DISPUTE);
            assert.equal(liquidationObject.liquidatedCollateral, convertCollateral("37.5"));
            assert.equal(liquidationObject.tokensOutstanding, convertSynthetic("3"));

            // Sponsor3 should be in a liquidation state with the bot as the liquidator. (5/5) = 100% of the 100 starting collateral and 5 tokens should be liquidated.
            liquidationObject = (await emp.getLiquidations(sponsor3))[0];
            assert.equal(liquidationObject.sponsor, sponsor3);
            assert.equal(liquidationObject.liquidator, liquidatorBot);
            assert.equal(liquidationObject.state, LiquidationStatesEnum.PRE_DISPUTE);
            assert.equal(liquidationObject.liquidatedCollateral, convertCollateral("100"));
            assert.equal(liquidationObject.tokensOutstanding, convertSynthetic("5"));

            // Sponsor1 should have some collateral and tokens left in their position from the liquidation.
            assert.equal((await emp.getCollateral(sponsor1)).rawValue, convertCollateral("50"));
            let positionObject = await emp.positions(sponsor1);
            assert.equal(positionObject.tokensOutstanding.rawValue, convertSynthetic("6"));

            // Sponsor2 should have some collateral and tokens left in their position from the liquidation.
            assert.equal((await emp.getCollateral(sponsor2)).rawValue, convertCollateral("62.5"));
            positionObject = await emp.positions(sponsor2);
            assert.equal(positionObject.tokensOutstanding.rawValue, convertSynthetic("5"));

            // Sponsor3 should not have a position remaining.
            assert.equal((await emp.getCollateral(sponsor3)).rawValue, 0);
          });

          it("amount-to-liquidate < min-sponsor-tokens", async function() {
            // We'll attempt to liquidate 4 tokens. The minimum sponsor position is 5. There are 3 different scenarios
            // we should test for, each of which we'll attempt to liquidate in one call of `liquidatePositions`.
            const amountToLiquidate = convertSynthetic("4");

            // 1. (tokens-outstanding - amount-to-liquidate) > min-sponsor-tokens, and amount-to-liquidate < tokens-outstanding.
            //     - The bot will be able to liquidate its desired amount, leaving the position above the minimum token threshold.
            //     - Example: (12 - 4) > 5, new position will have 8 tokens remaining.
            await emp.create(
              { rawValue: convertCollateral("100") },
              { rawValue: convertSynthetic("12") },
              { from: sponsor1 }
            );
            // 2. (tokens-outstanding - amount-to-liquidate) < min-sponsor-tokens, and amount-to-liquidate < tokens-outstanding.
            //     - The bot will NOT be able to liquidate its desired amount. It will liquidate a reduced amount and
            //       reduce the position exactly to the minimum.
            //     - Example: (8 - 4) <= 5, so instead the bot will liquidate (8 - 5) = 3 tokens to leave the position with (8 - 3) = 5 tokens remaining.
            await emp.create(
              { rawValue: convertCollateral("100") },
              { rawValue: convertSynthetic("8") },
              { from: sponsor2 }
            );
            // 3. amount-to-liquidate < tokens-outstanding, and amount-to-liquidate < min-sponsor-tokens.
            //     - The bot does not have enough balance to send a full liquidation, and partials are not allowed since 5 >= 5.
            await emp.create(
              { rawValue: convertCollateral("100") },
              { rawValue: convertSynthetic("5") },
              { from: sponsor3 }
            );

            // liquidatorBot creates a position with enough tokens to liquidate all positions.
            await emp.create(
              { rawValue: convertCollateral("10000") },
              { rawValue: convertSynthetic("50") },
              { from: liquidatorBot }
            );

            // Next, assume the price feed given to the liquidator has moved such that the sponsors
            // are all now undercollateralized. The liquidator bot should correctly identify this and liquidate the positions.
            // A price of 25 USD per token will make all positions undercollateralized.
            // Numerically debt * price * coltReq > debt for collateralized position.
            // Sponsor1: 12 * 25 * 1.2 > 100
            // Sponsor2: 8 * 25 * 1.2 > 100
            // Sponsor3: 5 * 25 * 1.2 > 100
            priceFeedMock.setCurrentPrice(convertPrice("25"));

            await liquidator.update();
            await liquidator.liquidatePositions(amountToLiquidate);
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
            // Dont know how to generalize this check for multi decimal paradigms
            if (testConfig.collateralDecimals == 18) {
              assert.equal(liquidationObject.liquidatedCollateral.rawValue, convertCollateral("33.3333333333333333"));
            } else if (testConfig.collateralDecimals == 8) {
              assert.equal(liquidationObject.liquidatedCollateral.rawValue, convertCollateral("33.33333333"));
            }
            assert.equal(liquidationObject.tokensOutstanding.rawValue, convertSynthetic("4"));

            // Sponsor2 should be in a liquidation state with the bot as the liquidator. (3/8) = 37.5% of the 100 starting collateral and 3 tokens should be liquidated.
            liquidationObject = (await emp.getLiquidations(sponsor2))[0];
            assert.equal(liquidationObject.sponsor, sponsor2);
            assert.equal(liquidationObject.liquidator, liquidatorBot);
            assert.equal(liquidationObject.state, LiquidationStatesEnum.PRE_DISPUTE);
            assert.equal(liquidationObject.liquidatedCollateral.rawValue, convertCollateral("37.5"));
            assert.equal(liquidationObject.tokensOutstanding.rawValue, convertSynthetic("3"));

            // Sponsor3 should not have been liquidated.

            // Sponsor1 should have some collateral and tokens left in their position from the liquidation.
            // Dont know how to generalize this check for multi decimal paradigms
            if (testConfig.collateralDecimals == 18) {
              assert.equal((await emp.getCollateral(sponsor1)).rawValue, convertCollateral("66.6666666666666667"));
            } else if (testConfig.collateralDecimals == 8) {
              assert.equal((await emp.getCollateral(sponsor1)).rawValue, convertCollateral("66.66666667"));
            }
            let positionObject = await emp.positions(sponsor1);
            assert.equal(positionObject.tokensOutstanding.rawValue, convertSynthetic("8"));

            // Sponsor2 should have some collateral and tokens left in their position from the liquidation.
            assert.equal((await emp.getCollateral(sponsor2)).rawValue, convertCollateral("62.5"));
            positionObject = await emp.positions(sponsor2);
            assert.equal(positionObject.tokensOutstanding.rawValue, convertSynthetic("5"));

            // Sponsor3 should have its full position remaining.
            assert.equal((await emp.getCollateral(sponsor3)).rawValue, convertCollateral("100"));
            positionObject = await emp.positions(sponsor3);
            assert.equal(positionObject.tokensOutstanding.rawValue, convertSynthetic("5"));
          });

          it("Overriding threshold correctly effects generated logs", async function() {
            // Liquidation events normally are `info` level. This override should change the value to `warn` which can be
            // validated after the log is generated.
            liquidatorConfig = { logOverrides: { positionLiquidated: "warn" } };
            liquidator = new Liquidator({
              logger: spyLogger,
              expiringMultiPartyClient: empClient,
              gasEstimator,
              votingContract: mockOracle.contract,
              syntheticToken: syntheticToken.contract,
              priceFeed: priceFeedMock,
              account: accounts[0],
              empProps,
              config: liquidatorConfig
            });

            // sponsor1 creates a position with 115 units of collateral, creating 100 synthetic tokens.
            await emp.create(
              { rawValue: convertCollateral("115") },
              { rawValue: convertSynthetic("100") },
              { from: sponsor1 }
            );

            // sponsor2 creates a position with 118 units of collateral, creating 100 synthetic tokens.
            await emp.create(
              { rawValue: convertCollateral("118") },
              { rawValue: convertSynthetic("100") },
              { from: sponsor2 }
            );

            // liquidatorBot creates a position to have synthetic tokens to pay off debt upon liquidation.
            await emp.create(
              { rawValue: convertCollateral("1000") },
              { rawValue: convertSynthetic("500") },
              { from: liquidatorBot }
            );

            priceFeedMock.setCurrentPrice(convertPrice("1"));
            assert.equal(spy.callCount, 0); // No log events before liquidation query
            await liquidator.update();
            await liquidator.liquidatePositions();
            assert.equal(spy.callCount, 1); // 1 log events after liquidation query.
            assert.equal(lastSpyLogLevel(spy), "warn"); // most recent log level should be "warn"
          });

          it("Can correctly override price feed input", async function() {
            // sponsor1 creates a position with 115 units of collateral, creating 100 synthetic tokens.
            await emp.create(
              { rawValue: convertCollateral("115") },
              { rawValue: convertSynthetic("100") },
              { from: sponsor1 }
            );

            // sponsor2 creates a position with 118 units of collateral, creating 100 synthetic tokens.
            await emp.create(
              { rawValue: convertCollateral("125") },
              { rawValue: convertSynthetic("100") },
              { from: sponsor2 }
            );

            // liquidatorBot creates a position to have synthetic tokens to pay off debt upon liquidation.
            await emp.create(
              { rawValue: convertCollateral("1000") },
              { rawValue: convertSynthetic("500") },
              { from: liquidatorBot }
            );

            // specify an override price of 0.5e18.
            liquidatorOverridePrice = convertPrice("0.5");
            // At a price point of 1 sponsor 1 is undercollateralized and sponsor 2 is overcollateralized. However, there
            // is an override price present at 0.5. At this price point neither position is undercollateralized and so
            // there should be no liquidation events generated from the liquidation call.
            priceFeedMock.setCurrentPrice(convertPrice("1"));
            assert.equal(spy.callCount, 0); // No log events before liquidation query

            // Next, call the `liquidatePositions` function with the override price. The `null` param is for
            // `maxTokensToLiquidateWei` which null will attempt to liquidate the full position, if undercollateralized.
            await liquidator.update();
            await liquidator.liquidatePositions(null, liquidatorOverridePrice);
            assert.equal(spy.callCount, 0); // still no liquidation events generated as price override is set to 0.5.

            let liquidationObject = await emp.getLiquidations(sponsor1);
            // There should be no liquidation's created.
            assert.equal(liquidationObject.length, 0);

            // Specifying a new override price that places one of the positions undercollateralized should initiate a liquidation.
            // This should again be independent of the price feed.
            priceFeedMock.setCurrentPrice(convertPrice("0.5")); // set the price feed to something that should not create a liquidation.

            liquidatorOverridePrice = convertPrice("1.0"); // specify an override price of 1.0e18. This should place sponsor 1 underwater.
            await liquidator.update();
            await liquidator.liquidatePositions(null, liquidatorOverridePrice);
            assert.equal(spy.callCount, 1); // This should initiate the liquidation event and so there should be 1 log.

            liquidationObject = await emp.getLiquidations(sponsor1);
            // There should be one liquidation created.
            assert.equal(liquidationObject.length, 1);
          });
        });
      });
      describe("enabling withdraw defense feature", () => {
        it("should initialize when enabled", async () => {
          const liquidatorConfig = {
            whaleDefenseFundWei: 1,
            defenseActivationPercent: 50
          };
          const liquidator = new Liquidator({
            logger: spyLogger,
            expiringMultiPartyClient: empClient,
            gasEstimator,
            votingContract: mockOracle.contract,
            syntheticToken: syntheticToken.contract,
            priceFeed: priceFeedMock,
            account: accounts[0],
            empProps,
            config: liquidatorConfig
          });
          assert.ok(liquidator);
        });
        it("full liquidation: should enable and not affect existing logic if not triggered", async () => {
          // In this test, the liquidator sets its `whaleDefenseFundWei` to a trivially small value.
          // Recall that the amount of capital available to the liquidator is: `tokenBalance - whaleDefenseFundWei`,
          // so by setting `whaleDefenseFundWei = 1 wei`, we make the liquidator's entire `tokenBalance` available
          // to it. So in this test, the WDF is not triggered because the liquidator has enough available capital
          // to liquidate a full position.
          const liquidatorConfig = {
            whaleDefenseFundWei: 1,
            defenseActivationPercent: 50
          };
          const liquidator = new Liquidator({
            logger: spyLogger,
            expiringMultiPartyClient: empClient,
            gasEstimator,
            votingContract: mockOracle.contract,
            syntheticToken: syntheticToken.contract,
            priceFeed: priceFeedMock,
            account: accounts[0],
            empProps,
            config: liquidatorConfig
          });
          // sponsor1 creates a position with 125 units of collateral, creating 100 synthetic tokens.
          await emp.create(
            { rawValue: convertCollateral("125") },
            { rawValue: convertSynthetic("100") },
            { from: sponsor1 }
          );

          // sponsor2 creates a position with 150 units of collateral, creating 100 synthetic tokens.
          await emp.create(
            { rawValue: convertCollateral("150") },
            { rawValue: convertSynthetic("100") },
            { from: sponsor2 }
          );

          // liquidatorBot creates a position to have synthetic tokens to pay off debt upon liquidation.
          await emp.create(
            { rawValue: convertCollateral("1000") },
            { rawValue: convertSynthetic("500") },
            { from: liquidatorBot }
          );

          // Start with a mocked price of 1 usd per token.
          // This puts both sponsors over collateralized so no liquidations should occur.
          priceFeedMock.setCurrentPrice(convertPrice("1"));
          await liquidator.update();
          await liquidator.liquidatePositions();
          assert.equal(spy.callCount, 0); // No info level logs should be sent.

          // There should be no liquidations created from any sponsor account
          assert.deepStrictEqual(await emp.getLiquidations(sponsor1), []);
          assert.deepStrictEqual(await emp.getLiquidations(sponsor2), []);

          // Both token sponsors should still have their positions with full collateral.
          assert.equal((await emp.getCollateral(sponsor1)).rawValue, convertCollateral("125"));
          assert.equal((await emp.getCollateral(sponsor2)).rawValue, convertCollateral("150"));

          // If sponsor1 requests a withdrawal of any amount of collateral above 5 units at the given price of 1 usd per token
          // their remaining position becomes undercollateralized. Say they request to withdraw 10 units of collateral.
          // This places their position with a CR of: 115 / (100 * 1) * 100 = 115%. This is below the CR threshold.
          await emp.requestWithdrawal({ rawValue: convertCollateral("10") }, { from: sponsor1 });

          // Advance time to the defenseActivationPercent to see if the WDF would trigger.
          let sponsor1Positions = await emp.positions(sponsor1);
          const withdrawLiveness = empProps.withdrawLiveness.toNumber();
          let nextTime = Math.ceil(Number(sponsor1Positions.withdrawalRequestPassTimestamp) - withdrawLiveness * 0.5);
          await emp.setCurrentTime(nextTime);

          priceFeedMock.setCurrentPrice(convertPrice("1"));
          await liquidator.update();
          await liquidator.liquidatePositions();
          assert.equal(spy.callCount, 1); // There should be one log from the liquidation event of the withdrawal.

          // There should be exactly one liquidation in sponsor1's account. The liquidated collateral should be the original
          // amount of collateral minus the collateral withdrawn. 125 - 10 = 115
          let liquidationObject = (await emp.getLiquidations(sponsor1))[0];
          assert.equal(liquidationObject.sponsor, sponsor1);
          assert.equal(liquidationObject.liquidator, liquidatorBot);
          assert.equal(liquidationObject.state, LiquidationStatesEnum.PRE_DISPUTE);
          assert.equal(liquidationObject.liquidatedCollateral, convertCollateral("115"));
          assert.equal(liquidationObject.lockedCollateral, convertCollateral("125"));

          // Advance the timer to the liquidation expiry.
          const liquidationTime = liquidationObject.liquidationTime;
          const liquidationLiveness = 1000;
          await emp.setCurrentTime(Number(liquidationTime) + liquidationLiveness);

          // Now that the liquidation has expired, the liquidator can withdraw rewards.
          const collateralPreWithdraw = await collateralToken.balanceOf(liquidatorBot);
          await liquidator.update();
          await liquidator.withdrawRewards();
          assert.equal(spy.callCount, 2); // 1 new info level events should be sent at the conclusion of the withdrawal. total 2.

          // Liquidator should have their collateral increased by Sponsor1's collateral.
          const collateralPostWithdraw = await collateralToken.balanceOf(liquidatorBot);
          assert.equal(
            toBN(collateralPreWithdraw)
              .add(toBN(convertCollateral("125")))
              .toString(),
            collateralPostWithdraw.toString()
          );

          // Liquidation data should have been deleted.
          assert.deepStrictEqual((await emp.getLiquidations(sponsor1))[0].state, LiquidationStatesEnum.UNINITIALIZED);

          // The other two positions should not have any liquidations associated with them.
          assert.deepStrictEqual(await emp.getLiquidations(sponsor2), []);
        });
        it("should trigger and only submit the emp minimum position", async () => {
          const liquidatorConfig = {
            // entire fund dedicated to strategy
            whaleDefenseFundWei: convertSynthetic("90"),
            // will extend even if withdraw progress is 0% (typically this would be set to 50% +)
            defenseActivationPercent: 0
          };
          const liquidator = new Liquidator({
            logger: spyLogger,
            expiringMultiPartyClient: empClient,
            gasEstimator,
            votingContract: mockOracle.contract,
            syntheticToken: syntheticToken.contract,
            priceFeed: priceFeedMock,
            account: accounts[0],
            empProps,
            config: liquidatorConfig
          });
          // sponsor1 creates a position with 120 units of collateral, creating 100 synthetic tokens.
          await emp.create(
            { rawValue: convertCollateral("120") },
            { rawValue: convertSynthetic("100") },
            { from: sponsor1 }
          );

          // liquidatorBot creates a position to have synthetic tokens to pay off debt upon liquidation.
          // does not have enough to liquidate entire position
          await emp.create(
            { rawValue: convertCollateral("1000") },
            { rawValue: convertSynthetic("90") },
            { from: liquidatorBot }
          );

          // Start with a mocked price of 1 usd per token.
          // This puts both sponsors over collateralized so no liquidations should occur.
          priceFeedMock.setCurrentPrice(convertPrice("1"));
          // sponsor withdraws below collat ratio
          await emp.requestWithdrawal({ rawValue: convertCollateral("10") }, { from: sponsor1 });
          await liquidator.update();
          await liquidator.liquidatePositions();

          // There should be exactly one liquidation in sponsor1's account. The liquidated collateral should be the original
          // amount of collateral minus the collateral withdrawn. 120 - 10 = 110
          let liquidationObject = (await emp.getLiquidations(sponsor1))[0];
          assert.equal(liquidationObject.sponsor, sponsor1);
          assert.equal(liquidationObject.liquidator, liquidatorBot);
          assert.equal(liquidationObject.state, LiquidationStatesEnum.PRE_DISPUTE);
          // minimum liquidation size / outstanding tokens * (outstanding collateral - withdraw amount)
          // 5 / 100 * ( 120 -10) = 5.5
          assert.equal(liquidationObject.liquidatedCollateral, convertCollateral("5.5"));
          // minimum liquidation size / outstanding tokens * outstading collateral
          // 5 / 100 * 120 = 6
          assert.equal(liquidationObject.lockedCollateral, convertCollateral("6"));
        });
        it("trigger multiple extensions and finally full liquidation", async () => {
          const liquidatorConfig = {
            // entire fund dedicated to strategy, allows 3 extensions
            whaleDefenseFundWei: toBN(empProps.minSponsorSize)
              .mul(toBN(10))
              .toString(),
            // will extend even if withdraw progress is 80% complete
            defenseActivationPercent: 80
          };
          const withdrawLiveness = empProps.withdrawLiveness.toNumber();
          const liquidator = new Liquidator({
            logger: spyLogger,
            expiringMultiPartyClient: empClient,
            gasEstimator,
            votingContract: mockOracle.contract,
            syntheticToken: syntheticToken.contract,
            priceFeed: priceFeedMock,
            account: accounts[0],
            empProps,
            config: liquidatorConfig
          });
          await emp.create(
            { rawValue: convertCollateral("120") },
            { rawValue: convertSynthetic("100") },
            { from: sponsor1 }
          );
          await emp.create(
            { rawValue: convertCollateral("120") },
            { rawValue: convertSynthetic("100") },
            { from: sponsor2 }
          );
          // we have enough to fully liquidate one, then we have to extend the other
          // wdf is 50, leaving 50 after first liquidation (200-100-50)
          await emp.create(
            { rawValue: convertCollateral("1000") },
            { rawValue: convertSynthetic("200") },
            { from: liquidatorBot }
          );

          // Start with a mocked price of 1 usd per token.
          // This puts both sponsors over collateralized so no liquidations should occur.
          priceFeedMock.setCurrentPrice(convertPrice("1"));

          // both sponsors under collateralized
          await emp.requestWithdrawal({ rawValue: convertCollateral("10") }, { from: sponsor1 });
          await emp.requestWithdrawal({ rawValue: convertCollateral("10") }, { from: sponsor2 });

          await liquidator.update();
          await liquidator.liquidatePositions();

          let [sponsor1Liquidation, sponsor2Liquidation] = [
            (await emp.getLiquidations(sponsor1))[0],
            (await emp.getLiquidations(sponsor2))[0]
          ];
          let sponsor2Positions = await emp.positions(sponsor2);

          assert.equal(sponsor1Liquidation.liquidatedCollateral, convertCollateral("110"));
          // 120 - 10 / 2 (half tokens liquidated)
          assert.equal(sponsor2Liquidation.liquidatedCollateral, convertCollateral("55"));

          // advance time to 50% of withdraw. This should not trigger extension until 80%
          let nextTime = Math.ceil(Number(sponsor2Positions.withdrawalRequestPassTimestamp) - withdrawLiveness * 0.5);

          await emp.setCurrentTime(nextTime);
          // running again, should have no change
          await liquidator.update();
          await liquidator.liquidatePositions();

          let sponsor2Liquidations = await emp.getLiquidations(sponsor2);
          sponsor2Positions = await emp.positions(sponsor2);
          // no new liquidations
          assert.equal(sponsor2Liquidations.length, 1);

          nextTime = Math.ceil(Number(sponsor2Positions.withdrawalRequestPassTimestamp) - withdrawLiveness * 0.2);

          await emp.setCurrentTime(nextTime);
          // running again, should have another liquidation
          await liquidator.update();
          await liquidator.liquidatePositions();

          sponsor2Liquidations = await emp.getLiquidations(sponsor2);
          sponsor2Positions = await emp.positions(sponsor2);
          assert.equal(sponsor2Liquidations.length, 2);
          // min collateral for min liquidation
          assert.equal(sponsor2Liquidations[1].liquidatedCollateral.rawValue, convertCollateral("5.5"));
          // show position has been extended
          assert.equal(
            sponsor2Positions.withdrawalRequestPassTimestamp.toNumber(),
            Number(sponsor2Liquidations[1].liquidationTime) + Number(withdrawLiveness)
          );

          // another extension
          // advance time to 80% of liquidation
          nextTime = Math.ceil(Number(sponsor2Positions.withdrawalRequestPassTimestamp) - withdrawLiveness * 0.2);
          await emp.setCurrentTime(nextTime);
          // running again, should have another liquidation
          await liquidator.update();
          await liquidator.liquidatePositions();

          sponsor2Liquidations = await emp.getLiquidations(sponsor2);
          sponsor2Positions = await emp.positions(sponsor2);

          // show a third liquidation has been added
          assert.equal(sponsor2Liquidations.length, 3);

          // finally allow full liquidation by adding more tokens to bot
          await emp.create(
            { rawValue: convertCollateral("1000") },
            { rawValue: convertSynthetic("200") },
            { from: liquidatorBot }
          );

          await liquidator.update();
          await liquidator.liquidatePositions();

          sponsor2Liquidations = await emp.getLiquidations(sponsor2);
          sponsor2Positions = await emp.positions(sponsor2);

          // show a fourth liquidation has been added ( final liquidation)
          assert.equal(sponsor2Liquidations.length, 4);
          // show position has been fully liquidated
          assert.equal(sponsor2Positions.tokensOutstanding, "0");
        });
      });
    });
  }
});
