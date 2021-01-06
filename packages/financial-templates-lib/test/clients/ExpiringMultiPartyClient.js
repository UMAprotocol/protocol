const { toWei, utf8ToHex, padRight } = web3.utils;
const { parseFixed } = require("@ethersproject/bignumber");
const winston = require("winston");

const { interfaceName, MAX_UINT_VAL, ZERO_ADDRESS } = require("@uma/common");
const { getTruffleContract } = require("@uma/core");

const CONTRACT_VERSION = "1.2.0";

const { ExpiringMultiPartyClient } = require("../../src/clients/ExpiringMultiPartyClient");

const ExpiringMultiParty = getTruffleContract("ExpiringMultiParty", web3, CONTRACT_VERSION);
const Finder = getTruffleContract("Finder", web3, CONTRACT_VERSION);
const IdentifierWhitelist = getTruffleContract("IdentifierWhitelist", web3, CONTRACT_VERSION);
const MockOracle = getTruffleContract("MockOracle", web3, CONTRACT_VERSION);
const Token = getTruffleContract("ExpandedERC20", web3, CONTRACT_VERSION);
const SyntheticToken = getTruffleContract("SyntheticToken", web3, CONTRACT_VERSION);
const Timer = getTruffleContract("Timer", web3, CONTRACT_VERSION);
const Store = getTruffleContract("Store", web3, CONTRACT_VERSION);

// Run the tests against 3 different kinds of token/synth decimal combinations:
// 1) matching 18 & 18 for collateral for most token types with normal tokens.
// 2) non-matching 8 collateral & 18 synthetic for legacy UMA synthetics.
// 3) matching 8 collateral & 8 synthetic for current UMA synthetics.
const configs = [
  { tokenSymbol: "WETH", collateralDecimals: 18, syntheticDecimals: 18, priceFeedDecimals: 18 },
  { tokenSymbol: "BTC", collateralDecimals: 8, syntheticDecimals: 18, priceFeedDecimals: 8 },
  {
    tokenSymbol: "BTC",
    collateralDecimals: 8,
    syntheticDecimals: 8,
    priceFeedDecimals: 18
  }
];

const Convert = decimals => number => parseFixed(number.toString(), decimals).toString();

contract("ExpiringMultiPartyClient.js", function(accounts) {
  for (let testConfig of configs) {
    describe(`${testConfig.collateralDecimals} collateral, ${testConfig.syntheticDecimals} synthetic & ${testConfig.priceFeedDecimals} pricefeed decimals`, function() {
      const sponsor1 = accounts[0];
      const sponsor2 = accounts[1];

      const zeroAddress = "0x0000000000000000000000000000000000000000";
      const unreachableDeadline = MAX_UINT_VAL;

      let collateralToken;
      let syntheticToken;
      let emp;
      let client;
      let mockOracle;
      let identifierWhitelist;
      let store;
      let identifier;
      let convertCollateral;
      let convertSynthetic;
      let convertPrice;
      let finder;
      let timer;

      const updateAndVerify = async (client, expectedSponsors, expectedPositions) => {
        await client.update();
        assert.deepStrictEqual(client.getAllSponsors().sort(), expectedSponsors.sort());
        assert.deepStrictEqual(client.getAllPositions().sort(), expectedPositions.sort());
      };

      before(async function() {
        identifier = `${testConfig.tokenName}TEST`;
        convertCollateral = Convert(testConfig.collateralDecimals);
        convertSynthetic = Convert(testConfig.syntheticDecimals);
        convertPrice = Convert(testConfig.priceFeedDecimals);
        collateralToken = await Token.new(
          testConfig.tokenSymbol + "Token", // Construct the token name.
          testConfig.tokenSymbol,
          testConfig.collateralDecimals,
          {
            from: sponsor1
          }
        );
        syntheticToken = await SyntheticToken.new("Test Synthetic Token", "SYNTH", testConfig.syntheticDecimals, {
          from: sponsor1
        });
        await collateralToken.addMember(1, sponsor1, { from: sponsor1 });
        await collateralToken.mint(sponsor1, convertSynthetic("100000"), { from: sponsor1 });
        await collateralToken.mint(sponsor2, convertSynthetic("100000"), { from: sponsor1 });

        identifierWhitelist = await IdentifierWhitelist.new();
        await identifierWhitelist.addSupportedIdentifier(utf8ToHex(identifier));

        finder = await Finder.new();
        timer = await Timer.new();
        store = await Store.new({ rawValue: "0" }, { rawValue: "0" }, timer.address);
        await finder.changeImplementationAddress(utf8ToHex(interfaceName.Store), store.address);

        await finder.changeImplementationAddress(
          utf8ToHex(interfaceName.IdentifierWhitelist),
          identifierWhitelist.address
        );

        mockOracle = await MockOracle.new(finder.address, timer.address);
        await finder.changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.address);
      });

      beforeEach(async function() {
        const constructorParams = {
          expirationTimestamp: "12345678900",
          withdrawalLiveness: "1000",
          collateralAddress: collateralToken.address,
          tokenAddress: syntheticToken.address,
          finderAddress: finder.address,
          priceFeedIdentifier: padRight(utf8ToHex(identifier), 64),
          liquidationLiveness: "1000",
          collateralRequirement: { rawValue: toWei("1.5") },
          disputeBondPct: { rawValue: toWei("0.1") },
          sponsorDisputeRewardPct: { rawValue: toWei("0.1") },
          disputerDisputeRewardPct: { rawValue: toWei("0.1") },
          minSponsorTokens: { rawValue: convertSynthetic("1") },
          timerAddress: timer.address,
          excessTokenBeneficiary: store.address,
          financialProductLibraryAddress: ZERO_ADDRESS
        };

        // The ExpiringMultiPartyClient does not emit any info `level` events.  Therefore no need to test Winston outputs.
        // DummyLogger will not print anything to console as only capture `info` level events.
        const dummyLogger = winston.createLogger({
          level: "info",
          transports: [new winston.transports.Console()]
        });

        emp = await ExpiringMultiParty.new(constructorParams);
        await syntheticToken.addMinter(emp.address);
        await syntheticToken.addBurner(emp.address);

        client = new ExpiringMultiPartyClient(
          dummyLogger,
          ExpiringMultiParty.abi,
          web3,
          emp.address,
          testConfig.collateralDecimals,
          testConfig.syntheticDecimals,
          testConfig.priceFeedDecimals
        );
        await collateralToken.approve(emp.address, convertCollateral("1000000"), { from: sponsor1 });
        await collateralToken.approve(emp.address, convertCollateral("1000000"), { from: sponsor2 });

        await syntheticToken.approve(emp.address, convertSynthetic("100000000"), { from: sponsor1 });
        await syntheticToken.approve(emp.address, convertSynthetic("100000000"), { from: sponsor2 });
      });

      it("Returns all positions", async function() {
        // Create a position and check that it is detected correctly from the client.
        await emp.create(
          { rawValue: convertCollateral("10") },
          { rawValue: convertSynthetic("50") },
          { from: sponsor1 }
        );
        await updateAndVerify(
          client,
          [sponsor1], // expected sponsor
          [
            {
              sponsor: sponsor1,
              numTokens: convertSynthetic("50"),
              amountCollateral: convertCollateral("10"),
              hasPendingWithdrawal: false,
              withdrawalRequestPassTimestamp: "0",
              withdrawalRequestAmount: "0"
            }
          ] // expected position
        );

        // Calling create again from the same sponsor should add additional collateral & debt.
        await emp.create(
          { rawValue: convertCollateral("10") },
          { rawValue: convertSynthetic("50") },
          { from: sponsor1 }
        );
        await updateAndVerify(
          client,
          [sponsor1],
          [
            {
              sponsor: sponsor1,
              numTokens: convertSynthetic("100"),
              amountCollateral: convertCollateral("20"),
              hasPendingWithdrawal: false,
              withdrawalRequestPassTimestamp: "0",
              withdrawalRequestAmount: "0"
            }
          ]
        );

        // Calling create from a new address will create a new position and this should be added the the client.
        await emp.create(
          { rawValue: convertCollateral("100") },
          { rawValue: convertSynthetic("45") },
          { from: sponsor2 }
        );
        await updateAndVerify(
          client,
          [sponsor1, sponsor2],
          [
            {
              sponsor: sponsor1,
              numTokens: convertSynthetic("100"),
              amountCollateral: convertCollateral("20"),
              hasPendingWithdrawal: false,
              withdrawalRequestPassTimestamp: "0",
              withdrawalRequestAmount: "0"
            },
            {
              sponsor: sponsor2,
              numTokens: convertSynthetic("45"),
              amountCollateral: convertCollateral("100"),
              hasPendingWithdrawal: false,
              withdrawalRequestPassTimestamp: "0",
              withdrawalRequestAmount: "0"
            }
          ]
        );

        // If a position is liquidated it should be removed from the list of positions and added to the undisputed liquidations.
        const { liquidationId } = await emp.createLiquidation.call(
          sponsor2,
          { rawValue: "0" },
          { rawValue: toWei("99999") },
          { rawValue: toWei("100") },
          unreachableDeadline,
          { from: sponsor1 }
        );
        await emp.createLiquidation(
          sponsor2,
          { rawValue: "0" },
          { rawValue: toWei("99999") },
          { rawValue: toWei("100") },
          unreachableDeadline,
          { from: sponsor1 }
        );

        await updateAndVerify(
          client,
          [sponsor1],
          [
            {
              sponsor: sponsor1,
              numTokens: convertSynthetic("100"),
              amountCollateral: convertCollateral("20"),
              hasPendingWithdrawal: false,
              withdrawalRequestPassTimestamp: "0",
              withdrawalRequestAmount: "0"
            }
          ]
        );
        const expectedLiquidations = [
          {
            sponsor: sponsor2,
            id: liquidationId.toString(),
            numTokens: convertSynthetic("45"),
            liquidatedCollateral: convertCollateral("100"),
            lockedCollateral: convertCollateral("100"),
            liquidationTime: (await emp.getCurrentTime()).toString(),
            state: "1",
            liquidator: sponsor1,
            disputer: zeroAddress
          }
        ];
        assert.deepStrictEqual(expectedLiquidations.sort(), client.getUndisputedLiquidations().sort());

        // Pending withdrawals state should be correctly identified.
        await emp.requestWithdrawal({ rawValue: convertCollateral("10") }, { from: sponsor1 });
        await client.update();

        await updateAndVerify(
          client,
          [sponsor1],
          [
            {
              sponsor: sponsor1,
              numTokens: convertSynthetic("100"),
              amountCollateral: convertCollateral("20"),
              hasPendingWithdrawal: true,
              withdrawalRequestPassTimestamp: (await emp.getCurrentTime())
                .add(await emp.withdrawalLiveness())
                .toString(),
              withdrawalRequestAmount: convertCollateral("10")
            }
          ]
        );

        // Remove the pending withdrawal and ensure it is removed from the client.
        await emp.cancelWithdrawal({ from: sponsor1 });
        await client.update();
        await updateAndVerify(
          client,
          [sponsor1],
          [
            {
              sponsor: sponsor1,
              numTokens: convertSynthetic("100"),
              amountCollateral: convertCollateral("20"),
              hasPendingWithdrawal: false,
              withdrawalRequestPassTimestamp: "0",
              withdrawalRequestAmount: "0"
            }
          ]
        );

        // Correctly returns sponsors who create, redeem.
        await emp.create(
          { rawValue: convertCollateral("100") },
          { rawValue: convertSynthetic("45") },
          { from: sponsor2 }
        );
        await emp.redeem({ rawValue: convertSynthetic("45") }, { from: sponsor2 });
        // as created and redeemed sponsor should not show up in table as they are no longer an active sponsor.

        await updateAndVerify(
          client,
          [sponsor1],
          [
            {
              sponsor: sponsor1,
              numTokens: convertSynthetic("100"),
              amountCollateral: convertCollateral("20"),
              hasPendingWithdrawal: false,
              withdrawalRequestPassTimestamp: "0",
              withdrawalRequestAmount: "0"
            }
          ]
        );
        // If sponsor, creates, redeemes and then creates again they should now appear in the table.
        await emp.create(
          { rawValue: convertCollateral("100") },
          { rawValue: convertSynthetic("45") },
          { from: sponsor2 }
        );
        await emp.redeem({ rawValue: convertSynthetic("45") }, { from: sponsor2 });
        await emp.create(
          { rawValue: convertCollateral("100") },
          { rawValue: convertSynthetic("45") },
          { from: sponsor2 }
        );
        await emp.redeem({ rawValue: convertSynthetic("45") }, { from: sponsor2 });
        await emp.create(
          { rawValue: convertCollateral("100") },
          { rawValue: convertSynthetic("45") },
          { from: sponsor2 }
        );

        await updateAndVerify(
          client,
          [sponsor1, sponsor2],
          [
            {
              sponsor: sponsor1,
              numTokens: convertSynthetic("100"),
              amountCollateral: convertCollateral("20"),
              hasPendingWithdrawal: false,
              withdrawalRequestPassTimestamp: "0",
              withdrawalRequestAmount: "0"
            },
            {
              sponsor: sponsor2,
              numTokens: convertSynthetic("45"),
              amountCollateral: convertCollateral("100"),
              hasPendingWithdrawal: false,
              withdrawalRequestPassTimestamp: "0",
              withdrawalRequestAmount: "0"
            }
          ]
        );
      });

      it("Returns undercollateralized positions", async function() {
        await emp.create(
          { rawValue: convertCollateral("150") },
          { rawValue: convertSynthetic("100") },
          { from: sponsor1 }
        );
        await emp.create(
          { rawValue: convertCollateral("1500") },
          { rawValue: convertSynthetic("100") },
          { from: sponsor2 }
        );

        await client.update();
        // At 150% collateralization requirement, the position is just collateralized enough at a token price of 1.
        assert.deepStrictEqual([], client.getUnderCollateralizedPositions(convertPrice("1")));
        // Undercollateralized at a price just above 1.
        assert.deepStrictEqual(
          [
            {
              sponsor: sponsor1,
              numTokens: convertSynthetic("100"),
              amountCollateral: convertCollateral("150"),
              hasPendingWithdrawal: false,
              withdrawalRequestPassTimestamp: "0",
              withdrawalRequestAmount: "0"
            }
          ],
          client.getUnderCollateralizedPositions(convertPrice("1.00000001"))
        );

        // After submitting a withdraw request that brings the position below the CR ratio the client should detect this.
        // Withdrawing just 1 wei of collateral will place the position below the CR ratio.
        await emp.requestWithdrawal({ rawValue: convertCollateral("1") }, { from: sponsor1 });

        await client.update();
        // Update client to get withdrawal information.
        const currentTime = Number(await emp.getCurrentTime());
        assert.deepStrictEqual(
          [
            {
              sponsor: sponsor1,
              numTokens: convertSynthetic("100"),
              amountCollateral: convertCollateral("150"),
              hasPendingWithdrawal: true,
              withdrawalRequestPassTimestamp: (currentTime + 1000).toString(),
              withdrawalRequestAmount: convertCollateral("1")
            }
          ],
          client.getUnderCollateralizedPositions(convertPrice("1"))
        );
      });

      it("Returns undisputed liquidations", async function() {
        const liquidator = sponsor2;

        await emp.create(
          { rawValue: convertCollateral("150") },
          { rawValue: convertSynthetic("100") },
          { from: sponsor1 }
        );
        await syntheticToken.transfer(liquidator, convertSynthetic("100"), { from: sponsor1 });

        // Create a new liquidation for account[0]'s position.
        const { liquidationId } = await emp.createLiquidation.call(
          sponsor1,
          { rawValue: "0" },
          { rawValue: toWei("9999999") },
          { rawValue: toWei("100") },
          unreachableDeadline,
          { from: liquidator }
        );
        await emp.createLiquidation(
          sponsor1,
          { rawValue: "0" },
          { rawValue: toWei("9999999") },
          { rawValue: toWei("100") },
          unreachableDeadline,
          { from: liquidator }
        );
        await client.update();

        const liquidations = client.getUndisputedLiquidations();
        // Disputable if the disputer believes the price was `1`, and not disputable if they believe the price was just
        // above `1`.
        assert.isTrue(client.isDisputable(liquidations[0], convertPrice("1")));
        assert.isFalse(client.isDisputable(liquidations[0], convertPrice("1.00000001")));

        // Dispute the liquidation and make sure it no longer shows up in the list.
        // We need to advance the Oracle time forward to make `requestPrice` work.
        await mockOracle.setCurrentTime(Number(await emp.getCurrentTime()) + 1);
        await emp.dispute(liquidationId.toString(), sponsor1, { from: sponsor1 });
        await client.update();

        // The disputed liquidation should no longer show up as undisputed.
        assert.deepStrictEqual([], client.getUndisputedLiquidations().sort());
      });

      it("Returns expired liquidations", async function() {
        const liquidator = sponsor2;

        await emp.create(
          { rawValue: convertCollateral("150") },
          { rawValue: convertSynthetic("100") },
          { from: sponsor1 }
        );
        await syntheticToken.transfer(liquidator, convertSynthetic("100"), { from: sponsor1 });
        await emp.requestWithdrawal({ rawValue: convertCollateral("10") }, { from: sponsor1 });

        // Create a new liquidation for account[0]'s position.
        await emp.createLiquidation.call(
          sponsor1,
          { rawValue: "0" },
          { rawValue: toWei("9999999") },
          { rawValue: toWei("100") },
          unreachableDeadline,
          { from: liquidator }
        );
        await emp.createLiquidation(
          sponsor1,
          { rawValue: "0" },
          { rawValue: toWei("9999999") },
          { rawValue: toWei("100") },
          unreachableDeadline,
          { from: liquidator }
        );
        await client.update();

        const liquidations = client.getUndisputedLiquidations();
        const liquidationTime = liquidations[0].liquidationTime;
        assert.deepStrictEqual(
          [
            {
              sponsor: sponsor1,
              id: "0",
              state: "1",
              liquidationTime: liquidationTime,
              numTokens: convertSynthetic("100"),
              liquidatedCollateral: convertCollateral("140"), // This should `lockedCollateral` reduced by requested withdrawal amount
              lockedCollateral: convertCollateral("150"),
              liquidator: liquidator,
              disputer: zeroAddress
            }
          ],
          liquidations
        );
        assert.deepStrictEqual([], client.getExpiredLiquidations().sort());

        // Move EMP time to the liquidation's expiry.
        const liquidationLiveness = 1000;
        await emp.setCurrentTime(Number(liquidationTime) + liquidationLiveness);
        await client.update();

        // The liquidation is registered by the EMP client as expired.
        assert.deepStrictEqual([], client.getUndisputedLiquidations().sort());
        const expiredLiquidations = client.getExpiredLiquidations();
        assert.deepStrictEqual(
          [
            {
              sponsor: sponsor1,
              id: "0",
              state: "1",
              liquidationTime: liquidationTime,
              numTokens: convertSynthetic("100"),
              liquidatedCollateral: convertCollateral("140"),
              lockedCollateral: convertCollateral("150"),
              liquidator: liquidator,
              disputer: zeroAddress
            }
          ],
          expiredLiquidations
        );

        // Withdraw from the expired liquidation and check that the liquidation is deleted.
        await emp.withdrawLiquidation("0", sponsor1, { from: liquidator });
        await client.update();
        assert.deepStrictEqual([], client.getExpiredLiquidations().sort());
      });

      it("Returns disputed liquidations", async function() {
        const liquidator = sponsor2;

        await emp.create(
          { rawValue: convertCollateral("150") },
          { rawValue: convertSynthetic("100") },
          { from: sponsor1 }
        );
        await syntheticToken.transfer(liquidator, convertSynthetic("100"), { from: sponsor1 });

        // Create a new liquidation for account[0]'s position.
        const { liquidationId } = await emp.createLiquidation.call(
          sponsor1,
          { rawValue: "0" },
          { rawValue: toWei("9999999") },
          { rawValue: toWei("100") },
          unreachableDeadline,
          { from: liquidator }
        );
        await emp.createLiquidation(
          sponsor1,
          { rawValue: "0" },
          { rawValue: toWei("9999999") },
          { rawValue: toWei("100") },
          unreachableDeadline,
          { from: liquidator }
        );
        await client.update();
        const liquidations = client.getUndisputedLiquidations();
        const liquidationTime = liquidations[0].liquidationTime;

        // There should be no disputed liquidations initially.
        assert.deepStrictEqual([], client.getDisputedLiquidations().sort());

        // Dispute the liquidation and make sure it no longer shows up in the list.
        // We need to advance the Oracle time forward to make `requestPrice` work.
        await mockOracle.setCurrentTime(Number(await emp.getCurrentTime()) + 1);
        await emp.dispute(liquidationId.toString(), sponsor1, { from: sponsor1 });
        await client.update();

        // The disputed liquidation should no longer show up as undisputed.
        assert.deepStrictEqual(
          [
            {
              sponsor: sponsor1,
              id: "0",
              state: "2",
              liquidationTime: liquidationTime,
              numTokens: convertSynthetic("100"),
              liquidatedCollateral: convertCollateral("150"),
              lockedCollateral: convertCollateral("150"),
              liquidator: liquidator,
              disputer: sponsor1
            }
          ],
          client.getDisputedLiquidations().sort()
        );
        assert.deepStrictEqual([], client.getUndisputedLiquidations().sort());

        // Force a price such that the dispute fails, and then
        // withdraw from the unsuccessfully disputed liquidation and check that the liquidation is deleted.
        const disputePrice = convertPrice("1.6");
        await mockOracle.pushPrice(utf8ToHex(identifier), liquidationTime, disputePrice);
        await emp.withdrawLiquidation("0", sponsor1, { from: liquidator });
        await client.update();
        assert.deepStrictEqual([], client.getDisputedLiquidations().sort());
      });
    });
  }
});
