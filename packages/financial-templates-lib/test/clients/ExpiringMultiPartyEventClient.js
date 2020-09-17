const { toWei } = web3.utils;
const winston = require("winston");

const { interfaceName, parseFixed } = require("@uma/common");
const { MAX_UINT_VAL } = require("@uma/common");

const { ExpiringMultiPartyEventClient } = require("../../src/clients/ExpiringMultiPartyEventClient");

const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const Finder = artifacts.require("Finder");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const MockOracle = artifacts.require("MockOracle");
const TokenFactory = artifacts.require("TokenFactory");
const Token = artifacts.require("ExpandedERC20");
const Timer = artifacts.require("Timer");
const Store = artifacts.require("Store");

const configs = [
  { tokenName: "UMA", collateralDecimals: 18 },
  { tokenName: "BTC", collateralDecimals: 8 }
];

const Convert = decimals => number => parseFixed(number.toString(), decimals).toString();

contract("ExpiringMultiPartyEventClient.js", function(accounts) {
  for (let tokenConfig of configs) {
    describe(`${tokenConfig.collateralDecimals} decimals`, function() {
      const tokenSponsor = accounts[0];
      const liquidator = accounts[1];
      const sponsor1 = accounts[2];
      const sponsor2 = accounts[3];
      const sponsor3 = accounts[4];

      const unreachableDeadline = MAX_UINT_VAL;

      // Contracts
      let collateralToken;
      let emp;
      let syntheticToken;
      let mockOracle;
      let identifierWhitelist;
      let store;
      let timer;

      // Test object for EMP event client
      let client;
      let dummyLogger;

      // re-used variables
      let expirationTime;
      let constructorParams;

      // Track new sponsor positions created in the `beforeEach` block so that we can test event querying
      // for NewSponsor events.
      let newSponsorTxObj1;
      let newSponsorTxObj2;
      let newSponsorTxObj3;

      let identifier;
      let convert;

      before(async function() {
        identifier = `${tokenConfig.tokenName}TEST`;
        convert = Convert(tokenConfig.collateralDecimals);
        collateralToken = await Token.new(
          tokenConfig.tokenName,
          tokenConfig.tokenName,
          tokenConfig.collateralDecimals,
          { from: tokenSponsor }
        );
        await collateralToken.addMember(1, tokenSponsor, { from: tokenSponsor });
        await collateralToken.mint(liquidator, convert("100000"), { from: tokenSponsor });
        await collateralToken.mint(sponsor1, convert("100000"), { from: tokenSponsor });
        await collateralToken.mint(sponsor2, convert("100000"), { from: tokenSponsor });
        await collateralToken.mint(sponsor3, convert("100000"), { from: tokenSponsor });

        identifierWhitelist = await IdentifierWhitelist.deployed();
        await identifierWhitelist.addSupportedIdentifier(web3.utils.utf8ToHex(identifier));

        // Create a mockOracle and finder. Register the mockOracle with the finder.
        finder = await Finder.deployed();
        timer = await Timer.deployed();
        store = await Store.deployed();
        mockOracle = await MockOracle.new(finder.address, timer.address);
        const mockOracleInterfaceName = web3.utils.utf8ToHex(interfaceName.Oracle);
        await finder.changeImplementationAddress(mockOracleInterfaceName, mockOracle.address);
      });

      beforeEach(async function() {
        const currentTime = await mockOracle.getCurrentTime.call();
        expirationTime = currentTime.toNumber() + 100; // 100 seconds in the future

        constructorParams = {
          expirationTimestamp: expirationTime.toString(),
          withdrawalLiveness: "1000",
          collateralAddress: collateralToken.address,
          finderAddress: Finder.address,
          tokenFactoryAddress: TokenFactory.address,
          priceFeedIdentifier: web3.utils.utf8ToHex(identifier),
          syntheticName: `Test ${identifier} Token`,
          syntheticSymbol: identifier,
          liquidationLiveness: "10",
          collateralRequirement: { rawValue: toWei("1.5") },
          disputeBondPct: { rawValue: toWei("0.1") },
          sponsorDisputeRewardPct: { rawValue: toWei("0.1") },
          disputerDisputeRewardPct: { rawValue: toWei("0.1") },
          minSponsorTokens: { rawValue: toWei("1") },
          timerAddress: timer.address,
          excessTokenBeneficiary: store.address
        };

        emp = await ExpiringMultiParty.new(constructorParams);

        // The ExpiringMultiPartyEventClient does not emit any info level events. Therefore no need to test Winston outputs.
        dummyLogger = winston.createLogger({
          level: "info",
          transports: [new winston.transports.Console()]
        });

        client = new ExpiringMultiPartyEventClient(dummyLogger, ExpiringMultiParty.abi, web3, emp.address);
        await collateralToken.approve(emp.address, convert("1000000"), { from: sponsor1 });
        await collateralToken.approve(emp.address, convert("1000000"), { from: sponsor2 });
        await collateralToken.approve(emp.address, convert("1000000"), { from: sponsor3 });

        syntheticToken = await Token.at(await emp.tokenCurrency());
        await syntheticToken.approve(emp.address, toWei("100000000"), { from: sponsor1 });
        await syntheticToken.approve(emp.address, toWei("100000000"), { from: sponsor2 });

        // Create two positions
        newSponsorTxObj1 = await emp.create({ rawValue: convert("10") }, { rawValue: toWei("50") }, { from: sponsor1 });
        newSponsorTxObj2 = await emp.create(
          { rawValue: convert("100") },
          { rawValue: toWei("45") },
          { from: sponsor2 }
        );

        // Seed the liquidator position
        await collateralToken.approve(emp.address, convert("1000000"), { from: liquidator });
        await syntheticToken.approve(emp.address, toWei("100000000"), { from: liquidator });
        newSponsorTxObj3 = await emp.create(
          { rawValue: convert("500") },
          { rawValue: toWei("200") },
          { from: liquidator }
        );
      });

      it("Return NewSponsor Events", async function() {
        // Update the client and check it has the new sponsor event stored correctly
        await client.clearState();

        // State is empty before update().
        assert.deepStrictEqual([], client.getAllNewSponsorEvents());

        await client.update();

        // Compare with expected processed event objects
        assert.deepStrictEqual(
          [
            {
              transactionHash: newSponsorTxObj1.tx,
              blockNumber: newSponsorTxObj1.receipt.blockNumber,
              sponsor: sponsor1,
              collateralAmount: convert("10"),
              tokenAmount: toWei("50")
            },
            {
              transactionHash: newSponsorTxObj2.tx,
              blockNumber: newSponsorTxObj2.receipt.blockNumber,
              sponsor: sponsor2,
              collateralAmount: convert("100"),
              tokenAmount: toWei("45")
            },
            {
              transactionHash: newSponsorTxObj3.tx,
              blockNumber: newSponsorTxObj3.receipt.blockNumber,
              sponsor: liquidator,
              collateralAmount: convert("500"),
              tokenAmount: toWei("200")
            }
          ],
          client.getAllNewSponsorEvents()
        );

        // Correctly adds only new events after last query
        const newSponsorTxObj4 = await emp.create(
          { rawValue: convert("10") },
          { rawValue: toWei("1") },
          { from: sponsor3 }
        );
        await client.clearState();
        await client.update();

        assert.deepStrictEqual(
          [
            {
              transactionHash: newSponsorTxObj4.tx,
              blockNumber: newSponsorTxObj4.receipt.blockNumber,
              sponsor: sponsor3,
              collateralAmount: convert("10"),
              tokenAmount: toWei("1")
            }
          ],
          client.getAllNewSponsorEvents()
        );
      });

      it("Return Create Events", async function() {
        // Update the client and check it has the new sponsor event stored correctly
        await client.clearState();

        // State is empty before update().
        assert.deepStrictEqual([], client.getAllCreateEvents());

        await client.update();

        // Compare with expected processed event objects
        assert.deepStrictEqual(
          [
            {
              transactionHash: newSponsorTxObj1.tx,
              blockNumber: newSponsorTxObj1.receipt.blockNumber,
              sponsor: sponsor1,
              collateralAmount: convert("10"),
              tokenAmount: toWei("50")
            },
            {
              transactionHash: newSponsorTxObj2.tx,
              blockNumber: newSponsorTxObj2.receipt.blockNumber,
              sponsor: sponsor2,
              collateralAmount: convert("100"),
              tokenAmount: toWei("45")
            },
            {
              transactionHash: newSponsorTxObj3.tx,
              blockNumber: newSponsorTxObj3.receipt.blockNumber,
              sponsor: liquidator,
              collateralAmount: convert("500"),
              tokenAmount: toWei("200")
            }
          ],
          client.getAllCreateEvents()
        );

        // Correctly adds only new events after last query
        const newSponsorTxObj4 = await emp.create(
          { rawValue: convert("10") },
          { rawValue: toWei("1") },
          { from: sponsor3 }
        );
        await client.clearState();
        await client.update();

        assert.deepStrictEqual(
          [
            {
              transactionHash: newSponsorTxObj4.tx,
              blockNumber: newSponsorTxObj4.receipt.blockNumber,
              sponsor: sponsor3,
              collateralAmount: convert("10"),
              tokenAmount: toWei("1")
            }
          ],
          client.getAllCreateEvents()
        );
      });

      it("Return Deposit Events", async function() {
        // Update the client and check it has the new sponsor event stored correctly
        await client.clearState();

        // State is empty before update().
        assert.deepStrictEqual([], client.getAllDepositEvents());

        const depositTxObj1 = await emp.deposit({ rawValue: convert("5") }, { from: sponsor1 });

        await client.update();

        // Compare with expected processed event objects
        assert.deepStrictEqual(
          [
            {
              transactionHash: depositTxObj1.tx,
              blockNumber: depositTxObj1.receipt.blockNumber,
              sponsor: sponsor1,
              collateralAmount: convert("5")
            }
          ],
          client.getAllDepositEvents()
        );

        // Correctly adds only new events after last query
        const depositTxObj2 = await emp.deposit({ rawValue: convert("3") }, { from: sponsor2 });
        await client.clearState();
        await client.update();

        assert.deepStrictEqual(
          [
            {
              transactionHash: depositTxObj2.tx,
              blockNumber: depositTxObj2.receipt.blockNumber,
              sponsor: sponsor2,
              collateralAmount: convert("3")
            }
          ],
          client.getAllDepositEvents()
        );
      });

      it("Return Withdraw Events", async function() {
        // Update the client and check it has the new sponsor event stored correctly
        await client.clearState();

        // State is empty before update().
        assert.deepStrictEqual([], client.getAllWithdrawEvents());

        // GCR is ~2.0, so sponsor2 and liquidator should be able to withdraw small amounts while keeping their CR above GCR.
        const withdrawTxObj1 = await emp.withdraw({ rawValue: convert("1") }, { from: liquidator });

        await client.update();

        // Compare with expected processed event objects
        assert.deepStrictEqual(
          [
            {
              transactionHash: withdrawTxObj1.tx,
              blockNumber: withdrawTxObj1.receipt.blockNumber,
              sponsor: liquidator,
              collateralAmount: convert("1")
            }
          ],
          client.getAllWithdrawEvents()
        );

        // Correctly adds only new events after last query
        const withdrawTxObj2 = await emp.withdraw({ rawValue: convert("2") }, { from: sponsor2 });
        await client.clearState();
        await client.update();

        assert.deepStrictEqual(
          [
            {
              transactionHash: withdrawTxObj2.tx,
              blockNumber: withdrawTxObj2.receipt.blockNumber,
              sponsor: sponsor2,
              collateralAmount: convert("2")
            }
          ],
          client.getAllWithdrawEvents()
        );
      });

      it("Return Redeem Events", async function() {
        // Update the client and check it has the new sponsor event stored correctly
        await client.clearState();

        // State is empty before update().
        assert.deepStrictEqual([], client.getAllRedeemEvents());

        // Redeem from liquidator who has many more than the min token amount
        const redeemTxObj1 = await emp.redeem({ rawValue: toWei("1") }, { from: liquidator });

        await client.update();

        // Compare with expected processed event objects
        assert.deepStrictEqual(
          [
            {
              transactionHash: redeemTxObj1.tx,
              blockNumber: redeemTxObj1.receipt.blockNumber,
              sponsor: liquidator,
              collateralAmount: convert("2.5"),
              tokenAmount: toWei("1")
            }
          ],
          client.getAllRedeemEvents()
        );

        // Correctly adds only new events after last query
        const redeemTxObj2 = await emp.redeem({ rawValue: toWei("1") }, { from: sponsor1 });
        await client.clearState();
        await client.update();

        assert.deepStrictEqual(
          [
            {
              transactionHash: redeemTxObj2.tx,
              blockNumber: redeemTxObj2.receipt.blockNumber,
              sponsor: sponsor1,
              collateralAmount: convert("0.2"),
              tokenAmount: toWei("1")
            }
          ],
          client.getAllRedeemEvents()
        );
      });

      it("Return RegularFee Events", async function() {
        await client.clearState();

        // State is empty before update()
        assert.deepStrictEqual([], client.getAllRegularFeeEvents());

        // Set fees to 1% per second and advance 1 second.
        await store.setFixedOracleFeePerSecondPerPfc({ rawValue: toWei("0.01") });
        await timer.setCurrentTime((await timer.getCurrentTime()).toNumber() + 1);
        const regularFeeTxObj1 = await emp.payRegularFees();

        await client.update();

        // Compare with expected processed event objects.
        // The starting collateral is 610 so 6.1 are paid in fees.
        assert.deepStrictEqual(
          [
            {
              transactionHash: regularFeeTxObj1.tx,
              blockNumber: regularFeeTxObj1.receipt.blockNumber,
              regularFee: convert("6.1"),
              lateFee: toWei("0")
            }
          ],
          client.getAllRegularFeeEvents()
        );

        // Correctly adds only new events after last query.
        // 1% of (610-6.1) = 603.9 is 6.039
        await timer.setCurrentTime((await timer.getCurrentTime()).toNumber() + 1);
        const regularFeeTxObj2 = await emp.payRegularFees();
        await client.clearState();
        await client.update();

        assert.deepStrictEqual(
          [
            {
              transactionHash: regularFeeTxObj2.tx,
              blockNumber: regularFeeTxObj2.receipt.blockNumber,
              regularFee: convert("6.039"),
              lateFee: toWei("0")
            }
          ],
          client.getAllRegularFeeEvents()
        );

        // Reset fees
        await store.setFixedOracleFeePerSecondPerPfc({ rawValue: "0" });
      });

      it("Return FinalFee Events", async function() {
        // Update the client and check it has the new sponsor event stored correctly
        await client.clearState();

        // State is empty before update()
        assert.deepStrictEqual([], client.getAllFinalFeeEvents());

        await store.setFinalFee(collateralToken.address, { rawValue: convert("1") });
        await emp.createLiquidation(
          sponsor1,
          { rawValue: "0" },
          { rawValue: toWei("99999") },
          { rawValue: toWei("1") },
          unreachableDeadline,
          { from: liquidator }
        );

        // Compare with expected processed event objects.
        const finalFeeTxObj1 = await emp.dispute("0", sponsor1, { from: sponsor2 });
        await client.update();
        assert.deepStrictEqual(
          [
            {
              transactionHash: finalFeeTxObj1.tx,
              blockNumber: finalFeeTxObj1.receipt.blockNumber,
              amount: convert("1")
            }
          ],
          client.getAllFinalFeeEvents()
        );

        // Correctly adds only new events after last query.
        await timer.setCurrentTime(await emp.expirationTimestamp());
        const finalFeeTxObj2 = await emp.expire();
        await client.clearState();
        await client.update();
        assert.deepStrictEqual(
          [
            {
              transactionHash: finalFeeTxObj2.tx,
              blockNumber: finalFeeTxObj2.receipt.blockNumber,
              amount: convert("1")
            }
          ],
          client.getAllFinalFeeEvents()
        );

        // Reset fees
        await store.setFinalFee(collateralToken.address, { rawValue: "0" });
      });

      it("Return Liquidation Events", async function() {
        // Create liquidation to liquidate sponsor2 from sponsor1
        const txObject1 = await emp.createLiquidation(
          sponsor1,
          { rawValue: "0" },
          { rawValue: toWei("99999") },
          { rawValue: toWei("100") },
          unreachableDeadline,
          { from: liquidator }
        );

        // Update the client and check it has the liquidation event stored correctly
        await client.clearState();

        // State is empty before update().
        assert.deepStrictEqual([], client.getAllLiquidationEvents());

        await client.update();

        // Compare with expected processed event object
        assert.deepStrictEqual(
          [
            {
              transactionHash: txObject1.tx,
              blockNumber: txObject1.receipt.blockNumber,
              sponsor: sponsor1,
              liquidator: liquidator,
              liquidationId: "0",
              tokensOutstanding: toWei("50"),
              lockedCollateral: convert("10"),
              liquidatedCollateral: convert("10")
            }
          ],
          client.getAllLiquidationEvents()
        );

        // Correctly adds a second event after creating a new liquidation
        const txObject2 = await emp.createLiquidation(
          sponsor2,
          { rawValue: "0" },
          { rawValue: toWei("99999") },
          { rawValue: toWei("100") },
          unreachableDeadline,
          { from: liquidator }
        );
        await client.clearState();
        await client.update();
        assert.deepStrictEqual(
          [
            {
              transactionHash: txObject2.tx,
              blockNumber: txObject2.receipt.blockNumber,
              sponsor: sponsor2,
              liquidator: liquidator,
              liquidationId: "0",
              tokensOutstanding: toWei("45"),
              lockedCollateral: convert("100"),
              liquidatedCollateral: convert("100")
            }
          ],
          client.getAllLiquidationEvents()
        );
      });

      it("Return Dispute Events", async function() {
        // Create liquidation to liquidate sponsor2 from sponsor1
        await emp.createLiquidation(
          sponsor1,
          { rawValue: "0" },
          { rawValue: toWei("99999") },
          { rawValue: toWei("100") },
          unreachableDeadline,
          { from: liquidator }
        );

        const txObject = await emp.dispute("0", sponsor1, { from: sponsor2 });

        // Update the client and check it has the dispute event stored correctly
        await client.clearState();

        // State is empty before update().
        assert.deepStrictEqual([], client.getAllDisputeEvents());

        await client.update();

        // Compare with expected processed event object
        assert.deepStrictEqual(
          [
            {
              transactionHash: txObject.tx,
              blockNumber: txObject.receipt.blockNumber,
              sponsor: sponsor1,
              liquidator: liquidator,
              disputer: sponsor2,
              liquidationId: "0",
              disputeBondAmount: convert("1") // 10% of the liquidated position's collateral.
            }
          ],
          client.getAllDisputeEvents()
        );
      });

      it("Return Dispute Settlement Events", async function() {
        // Create liquidation to liquidate sponsor2 from sponsor1
        const liquidationTime = (await emp.getCurrentTime()).toNumber();
        await emp.createLiquidation(
          sponsor1,
          { rawValue: "0" },
          { rawValue: toWei("99999") },
          { rawValue: toWei("100") },
          unreachableDeadline,
          { from: liquidator }
        );

        // Dispute the position from the second sponsor
        await emp.dispute("0", sponsor1, {
          from: sponsor2
        });

        // Advance time and settle
        const timeAfterLiquidationLiveness = liquidationTime + 10;
        await mockOracle.setCurrentTime(timeAfterLiquidationLiveness.toString());
        await emp.setCurrentTime(timeAfterLiquidationLiveness.toString());

        // Force a price such that the dispute fails, and then withdraw from the unsuccessfully
        // disputed liquidation.
        const disputePrice = toWei("1.6");
        await mockOracle.pushPrice(web3.utils.utf8ToHex(identifier), liquidationTime, disputePrice);

        const txObject = await emp.withdrawLiquidation("0", sponsor1, { from: liquidator });
        await client.clearState();

        // State is empty before update().
        assert.deepStrictEqual([], client.getAllDisputeSettlementEvents());

        // Update the client and check it has the dispute event stored correctly
        await client.update();

        // Compare with expected processed event object
        assert.deepStrictEqual(
          [
            {
              transactionHash: txObject.tx,
              blockNumber: txObject.receipt.blockNumber,
              caller: liquidator,
              sponsor: sponsor1,
              liquidator: liquidator,
              disputer: sponsor2,
              liquidationId: "0",
              disputeSucceeded: false // Settlement price makes liquidation valid
            }
          ],
          client.getAllDisputeSettlementEvents()
        );
      });

      it("Return Liquidation Withdrawn Events", async function() {
        // Create liquidation to liquidate sponsor1
        const liquidationTime = (await emp.getCurrentTime()).toNumber();
        await emp.createLiquidation(
          sponsor1,
          { rawValue: "0" },
          { rawValue: toWei("99999") },
          { rawValue: toWei("100") },
          unreachableDeadline,
          { from: liquidator }
        );

        // Dispute the position from the second sponsor
        await emp.dispute("0", sponsor1, {
          from: sponsor2
        });

        // Advance time and settle
        const timeAfterLiquidationLiveness = liquidationTime + 10;
        await mockOracle.setCurrentTime(timeAfterLiquidationLiveness.toString());
        await emp.setCurrentTime(timeAfterLiquidationLiveness.toString());

        // Force a price such that the dispute succeeds, and then withdraw from the successfully
        // disputed liquidation.
        const disputePrice = convert("0.1");
        await mockOracle.pushPrice(web3.utils.utf8ToHex(identifier), liquidationTime, disputePrice);

        const txObject = await emp.withdrawLiquidation("0", sponsor1, { from: liquidator });
        await client.clearState();

        // State is empty before update().
        assert.deepStrictEqual([], client.getAllLiquidationWithdrawnEvents());

        // Update the client and check it has the liquidation withdrawn event stored correctly
        await client.update();

        // Compare with expected processed event object
        assert.deepStrictEqual(
          [
            {
              transactionHash: txObject.tx,
              blockNumber: txObject.receipt.blockNumber,
              caller: liquidator,
              withdrawalAmount: convert("4"), // On successful disputes, liquidator gets TRV - dispute rewards. TRV = (50 * 0.1 = 5), and rewards = (TRV * 0.1 = 5 * 0.1 = 0.5).
              liquidationStatus: "3" // Settlement price makes dispute successful
            }
          ],
          client.getAllLiquidationWithdrawnEvents()
        );
      });

      it("Return SettleExpiredPosition Events", async function() {
        await client.clearState();

        // State is empty before update()
        assert.deepStrictEqual([], client.getAllSettleExpiredPositionEvents());

        // Expire contract at settlement price of 0.2.
        await timer.setCurrentTime(expirationTime.toString());
        await emp.expire();
        await mockOracle.pushPrice(web3.utils.utf8ToHex(identifier), expirationTime.toString(), convert("0.2"));
        const txObject = await emp.settleExpired({ from: sponsor1 });

        await client.update();

        // Compare with expected processed event objects.
        assert.deepStrictEqual(
          [
            {
              transactionHash: txObject.tx,
              blockNumber: txObject.receipt.blockNumber,
              caller: sponsor1,
              collateralReturned: convert("10"), // Sponsor should get back all collateral in position because they still hold all tokens
              tokensBurned: toWei("50")
            }
          ],
          client.getAllSettleExpiredPositionEvents()
        );

        // Correctly adds only new events after last query.
        const txObject2 = await emp.settleExpired({ from: sponsor2 });
        await client.clearState();
        await client.update();
        assert.deepStrictEqual(
          [
            {
              transactionHash: txObject2.tx,
              blockNumber: txObject2.receipt.blockNumber,
              caller: sponsor2,
              collateralReturned: convert("100"), // Sponsor should get back all collateral in position because they still hold all tokens
              tokensBurned: toWei("45")
            }
          ],
          client.getAllSettleExpiredPositionEvents()
        );
      });

      it("Starting client at an offset block number", async function() {
        // Init the EMP event client with an offset block number. If the current block number is used then all log events
        // generated before the creation of the client should not be included. Rather, only subsequent logs should be reported.

        // Create liquidation (in the past)
        const txObject1 = await emp.createLiquidation(
          sponsor1,
          { rawValue: "0" },
          { rawValue: toWei("99999") },
          { rawValue: toWei("100") },
          unreachableDeadline,
          { from: liquidator }
        );

        // Start the liquidator bot from current time stamp (liquidation in the past)
        const currentBlockNumber = await web3.eth.getBlockNumber();
        const offSetClient = new ExpiringMultiPartyEventClient(
          dummyLogger,
          ExpiringMultiParty.abi,
          web3,
          emp.address,
          currentBlockNumber + 1 // Start the bot one block after the liquidation event
        );

        await offSetClient.update();

        assert.deepStrictEqual([], offSetClient.getAllLiquidationEvents()); // Created liquidation should not be captured
        assert.deepStrictEqual([], offSetClient.getAllDisputeEvents());
        assert.deepStrictEqual([], offSetClient.getAllDisputeSettlementEvents());
      });
    });
  }
});
