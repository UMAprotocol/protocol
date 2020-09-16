const { toWei, toBN, hexToUtf8 } = web3.utils;
const winston = require("winston");
const sinon = require("sinon");
const { interfaceName, parseFixed } = require("@uma/common");

// Script to test
const { CRMonitor } = require("../src/CRMonitor");

// Helpers and custom winston transport module to monitor winston log outputs
const {
  ExpiringMultiPartyClient,
  PriceFeedMockScaled: PriceFeedMock,
  SpyTransport,
  lastSpyLogIncludes,
  lastSpyLogLevel
} = require("@uma/financial-templates-lib");

// Truffle artifacts
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const Finder = artifacts.require("Finder");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const MockOracle = artifacts.require("MockOracle");
const TokenFactory = artifacts.require("TokenFactory");
const Token = artifacts.require("ExpandedERC20");
const Timer = artifacts.require("Timer");
const Store = artifacts.require("Store");

const configs = [
  { tokenName: "WETH", collateralDecimals: 18 },
  { tokenName: "BTC", collateralDecimals: 8 }
];

const Convert = decimals => number => parseFixed(number.toString(), decimals).toString();

contract("CRMonitor.js", function(accounts) {
  for (let tokenConfig of configs) {
    describe(`${tokenConfig.collateralDecimals} decimals`, function() {
      const tokenSponsor = accounts[0];
      const monitoredTrader = accounts[1];
      const monitoredSponsor = accounts[2];

      // Contracts
      let collateralToken;
      let emp;
      let syntheticToken;
      let mockOracle;
      let identifierWhitelist;

      // Test object for EMP event client
      let eventClient;

      // Price feed mock
      let priceFeedMock;
      let spyLogger;
      let spy;

      // re-used variables
      let expirationTime;
      let constructorParams;
      let currentTime;
      let empClient;
      let monitorConfig;
      let crMonitor;
      let empProps;

      before(async function() {
        identifier = `${tokenConfig.tokenName}TEST`;
        convertCollateralToWei = num => ConvertDecimals(tokenConfig.collateralDecimals, 18, web3)(num).toString();
        convert = Convert(tokenConfig.collateralDecimals);
        collateralToken = await Token.new(
          tokenConfig.tokenName,
          tokenConfig.tokenName,
          tokenConfig.collateralDecimals,
          { from: tokenSponsor }
        );
        collateralToken = await Token.new(
          tokenConfig.tokenName,
          tokenConfig.tokenName,
          tokenConfig.collateralDecimals,
          { from: tokenSponsor }
        );

        identifierWhitelist = await IdentifierWhitelist.deployed();
        await identifierWhitelist.addSupportedIdentifier(web3.utils.utf8ToHex(tokenConfig.tokenName));

        // Create a mockOracle and finder. Register the mockOracle with the finder.
        finder = await Finder.deployed();
        mockOracle = await MockOracle.new(finder.address, Timer.address);
        const mockOracleInterfaceName = web3.utils.utf8ToHex(interfaceName.Oracle);
        await finder.changeImplementationAddress(mockOracleInterfaceName, mockOracle.address);
      });

      beforeEach(async function() {
        currentTime = await mockOracle.getCurrentTime.call();
        timer = await Timer.deployed();
        await timer.setCurrentTime(currentTime.toString());
        expirationTime = currentTime.toNumber() + 100; // 100 seconds in the future
        const store = await Store.deployed();

        constructorParams = {
          isTest: true,
          expirationTimestamp: expirationTime.toString(),
          withdrawalLiveness: "10",
          collateralAddress: collateralToken.address,
          finderAddress: Finder.address,
          tokenFactoryAddress: TokenFactory.address,
          timerAddress: Timer.address,
          priceFeedIdentifier: web3.utils.utf8ToHex(tokenConfig.tokenName),
          syntheticName: `Test ${collateralToken} Token`,
          syntheticSymbol: identifier,
          liquidationLiveness: "10",
          collateralRequirement: { rawValue: toWei("1.5") },
          disputeBondPct: { rawValue: toWei("0.1") },
          sponsorDisputeRewardPct: { rawValue: toWei("0.1") },
          disputerDisputeRewardPct: { rawValue: toWei("0.1") },
          minSponsorTokens: { rawValue: toWei("1") },
          excessTokenBeneficiary: store.address
        };

        // Create a sinon spy and give it to the SpyTransport as the winston logger. Use this to check all winston
        // logs the correct text based on interactions with the emp. Note that only `info` level messages are captured.
        spy = sinon.spy();
        spyLogger = winston.createLogger({
          level: "info",
          transports: [new SpyTransport({ level: "info" }, { spy: spy })]
        });

        emp = await ExpiringMultiParty.new(constructorParams);
        empClient = new ExpiringMultiPartyClient(spyLogger, ExpiringMultiParty.abi, web3, emp.address);
        priceFeedMock = new PriceFeedMock();

        monitorConfig = {
          walletsToMonitor: [
            {
              name: "Monitored trader wallet",
              address: monitoredTrader,
              crAlert: 2.0 // if the collateralization ratio of this wallet drops below 200% send an alert
            },
            {
              name: "Monitored sponsor wallet",
              address: monitoredSponsor,
              crAlert: 1.5 // if the collateralization ratio of this wallet drops below 150% send an alert
            }
          ]
        };
        syntheticToken = await Token.at(await emp.tokenCurrency());

        empProps = {
          collateralCurrencySymbol: await collateralToken.symbol(),
          collateralCurrencyDecimals: tokenConfig.collateralDecimals,
          syntheticCurrencyDecimals: 18,
          syntheticCurrencySymbol: await syntheticToken.symbol(),
          priceIdentifier: hexToUtf8(await emp.priceIdentifier()),
          networkId: await web3.eth.net.getId()
        };

        crMonitor = new CRMonitor({
          logger: spyLogger,
          expiringMultiPartyClient: empClient,
          priceFeed: priceFeedMock,
          config: monitorConfig,
          empProps
        });

        await collateralToken.addMember(1, tokenSponsor, {
          from: tokenSponsor
        });

        //   Bulk mint and approve for all wallets
        for (let i = 1; i < 3; i++) {
          await collateralToken.mint(accounts[i], toWei("100000000"), {
            from: tokenSponsor
          });
          await collateralToken.approve(emp.address, toWei("100000000"), {
            from: accounts[i]
          });
          await syntheticToken.approve(emp.address, toWei("100000000"), {
            from: accounts[i]
          });
        }

        // Create positions for the monitoredTrader and monitoredSponsor accounts
        await emp.create({ rawValue: convert("250") }, { rawValue: toWei("100") }, { from: monitoredTrader });
        await emp.create({ rawValue: convert("300") }, { rawValue: toWei("100") }, { from: monitoredSponsor });
      });

      it("Winston correctly emits collateralization ratio message", async function() {
        // No messages created if safely above the CR threshold
        await empClient.update();
        priceFeedMock.setCurrentPrice("1");
        await crMonitor.checkWalletCrRatio();
        assert.equal(spy.callCount, 0);

        // Emits a message if below the CR threshold. At a price of 1.3 only the monitoredTrader should be undercollateralized
        // with a CR of 250 / (100 * 1.3) =1.923 which is below this addresses threshold of 200 and should emit a message.
        await empClient.update();
        priceFeedMock.setCurrentPrice("1.3");
        await crMonitor.checkWalletCrRatio();
        assert.equal(spy.callCount, 1);
        assert.isTrue(lastSpyLogIncludes(spy, "Collateralization ratio alert"));
        assert.isTrue(lastSpyLogIncludes(spy, "Monitored trader wallet")); // Monitored wallet name from `monitorConfig`
        assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${monitoredTrader}`)); // liquidator address
        assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${monitoredTrader}`)); // liquidator address
        assert.isTrue(lastSpyLogIncludes(spy, "192.30%")); // calculated CR ratio for this position
        assert.isTrue(lastSpyLogIncludes(spy, "200%")); // calculated CR ratio threshold for this address
        assert.isTrue(lastSpyLogIncludes(spy, "1.30")); // Current price of the identifer
        assert.isTrue(lastSpyLogIncludes(spy, identifier)); // Synthetic token symbol
        assert.isTrue(lastSpyLogIncludes(spy, "150.00%")); // Collateralization requirement
        assert.isTrue(lastSpyLogIncludes(spy, "1.66")); // Liquidation price
        assert.equal(lastSpyLogLevel(spy), "warn");

        // The message should be sent every time the bot is polled and there is a crossing of the threshold line. At a price
        // of 1.2 monitoredTrader's CR = 250/(100*1.2) = 2.083 and monitoredSponsor's CR = 300/(100*1.2) = 2.5 which places
        // both monitored wallets above their thresholds. As a result no new message should be sent.
        await empClient.update();
        priceFeedMock.setCurrentPrice("1.2");
        await crMonitor.checkWalletCrRatio();
        assert.equal(spy.callCount, 1); // no new message.

        // Crossing the price threshold for both sponsors should emit exactly 2 new messages. At a price of 2.1
        // monitoredTrader's CR = 250/(100*2.1) = 1.1904 and monitoredSponsor's CR = 300/(100*2.1) = 1.42857. At these CRs
        // Both bots are below their thresholds
        await empClient.update();
        priceFeedMock.setCurrentPrice("2.1");
        await crMonitor.checkWalletCrRatio();
        assert.equal(spy.callCount, 3); // two new messages

        // A second check below this threshold should again trigger messages for both sponsors.
        await empClient.update();
        priceFeedMock.setCurrentPrice("2.1");
        await crMonitor.checkWalletCrRatio();
        assert.equal(spy.callCount, 5);

        // Reset the price to over collateralized state for both accounts by moving the price into the lower value. This
        // should not emit any events as both correctly collateralized.
        await empClient.update();
        priceFeedMock.setCurrentPrice("1");
        await crMonitor.checkWalletCrRatio();
        assert.equal(spy.callCount, 5);

        // In addition to the price moving of the synthetic, adding/removing collateral or creating/redeeming debt can also
        // impact a positions collateralization ratio. If monitoredTrader was to withdraw some collateral after waiting the
        // withdrawal liveness they can place their position's collateralization under the threshold. Say monitoredTrader
        // withdraws 75 units of collateral. Given price is 1 unit of synthetic for each unit of debt. This would place
        // their position at a collateralization ratio of 175/(100*1)=1.75. monitoredSponsor is at 300/(100*1)=3.00.
        await emp.requestWithdrawal({ rawValue: convert("75") }, { from: monitoredTrader });

        // The wallet CR should reflect the requested withdrawal amount.
        await empClient.update();
        await crMonitor.checkWalletCrRatio();
        await crMonitor.checkWalletCrRatio();
        assert.equal(spy.callCount, 7); // a new message is sent.
        assert.isTrue(lastSpyLogIncludes(spy, "Monitored trader wallet")); // Monitored wallet name from `MonitorConfig`
        assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${monitoredTrader}`)); // liquidator address
        assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${monitoredTrader}`)); // liquidator address
        assert.isTrue(lastSpyLogIncludes(spy, "175.00%")); // calculated CR ratio for this position
        assert.isTrue(lastSpyLogIncludes(spy, "200%")); // calculated CR ratio threshold for this address
        assert.isTrue(lastSpyLogIncludes(spy, "1.00")); // Current price of the identifer
        assert.isTrue(lastSpyLogIncludes(spy, identifier)); // Synthetic token symbol

        // Advance time after withdrawal liveness. Check that CR detected is the same
        // post withdrawal execution
        currentTime = await timer.getCurrentTime.call();
        await timer.setCurrentTime(currentTime.toNumber() + 11);
        await emp.withdrawPassedRequest({ from: monitoredTrader });

        await empClient.update();
        await crMonitor.checkWalletCrRatio();
        assert.equal(spy.callCount, 8); // a new message is sent.
        assert.isTrue(lastSpyLogIncludes(spy, "Monitored trader wallet")); // Monitored wallet name from `MonitorConfig`
        assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${monitoredTrader}`)); // liquidator address
        assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${monitoredTrader}`)); // liquidator address
        assert.isTrue(lastSpyLogIncludes(spy, "175.00%")); // calculated CR ratio for this position
        assert.isTrue(lastSpyLogIncludes(spy, "200%")); // calculated CR ratio threshold for this address
        assert.isTrue(lastSpyLogIncludes(spy, "1.00")); // Current price of the identifer
        assert.isTrue(lastSpyLogIncludes(spy, identifier)); // Synthetic token symbol
      });
      it("Cannot set invalid config", async function() {
        let errorThrown1;
        try {
          // Create an invalid config. A valid config expects an array of objects with keys in the object of `name` `address`
          // and `crAlert`.
          const invalidMonitorConfig1 = {
            // Config missing `crAlert`.
            walletsToMonitor: [
              {
                name: "Sponsor wallet",
                address: tokenSponsor
              }
            ]
          };

          balanceMonitor = new CRMonitor({
            logger: spyLogger,
            expiringMultiPartyClient: empClient,
            priceFeed: priceFeedMock,
            config: invalidMonitorConfig1,
            empProps
          });
          errorThrown1 = false;
        } catch (err) {
          errorThrown1 = true;
        }
        assert.isTrue(errorThrown1);

        let errorThrown2;
        try {
          // Create an invalid config. A valid config expects an array of objects with keys in the object of `name` `address`
          // `collateralThreshold`, `etherThreshold`. The value of `address` must be of type address.
          const invalidMonitorConfig2 = {
            // Config has an invalid address for the monitored bot.
            walletsToMonitor: [
              {
                name: "Sponsor wallet",
                address: "INVALID_ADDRESS",
                crAlert: 1.5
              }
            ]
          };

          crMonitor = new CRMonitor({
            logger: spyLogger,
            expiringMultiPartyClient: empClient,
            priceFeed: priceFeedMock,
            config: invalidMonitorConfig2,
            empProps
          });
          errorThrown2 = false;
        } catch (err) {
          errorThrown2 = true;
        }
        assert.isTrue(errorThrown2);
      });
      it("Can correctly CR Monitor and check wallet CR Ratios with no config provided", async function() {
        const emptyConfig = {};
        let errorThrown;
        try {
          crMonitor = new CRMonitor({
            logger: spyLogger,
            expiringMultiPartyClient: empClient,
            priceFeed: priceFeedMock,
            config: emptyConfig,
            empProps
          });
          await crMonitor.checkWalletCrRatio();
          errorThrown = false;
        } catch (err) {
          errorThrown = true;
        }
        assert.isFalse(errorThrown);
      });
      it("Can override the synthetic-threshold log level", async function() {
        const alertOverrideConfig = { ...monitorConfig, logOverrides: { crThreshold: "error" } };
        crMonitor = new CRMonitor({
          logger: spyLogger,
          expiringMultiPartyClient: empClient,
          priceFeed: priceFeedMock,
          config: alertOverrideConfig,
          empProps
        });

        // Increase price to lower wallet CR below threshold
        await empClient.update();
        priceFeedMock.setCurrentPrice("1.3");
        await crMonitor.checkWalletCrRatio();
        assert.isTrue(lastSpyLogIncludes(spy, "Collateralization ratio alert"));
        assert.equal(lastSpyLogLevel(spy), "error");
      });
    });
  }
});
