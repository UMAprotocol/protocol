const { toWei } = web3.utils;
const winston = require("winston");

const { interfaceName } = require("../../../core/utils/Constants.js");
const { MAX_UINT_VAL } = require("../../../common/Constants.js");

const { ExpiringMultiPartyEventClient } = require("../../clients/ExpiringMultiPartyEventClient");

const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const Finder = artifacts.require("Finder");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const MockOracle = artifacts.require("MockOracle");
const TokenFactory = artifacts.require("TokenFactory");
const Token = artifacts.require("ExpandedERC20");
const Timer = artifacts.require("Timer");

contract("ExpiringMultiPartyEventClient.js", function(accounts) {
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

  before(async function() {
    collateralToken = await Token.new("UMA", "UMA", 18, { from: tokenSponsor });
    await collateralToken.addMember(1, tokenSponsor, { from: tokenSponsor });
    await collateralToken.mint(liquidator, toWei("100000"), { from: tokenSponsor });
    await collateralToken.mint(sponsor1, toWei("100000"), { from: tokenSponsor });
    await collateralToken.mint(sponsor2, toWei("100000"), { from: tokenSponsor });
    await collateralToken.mint(sponsor3, toWei("100000"), { from: tokenSponsor });

    identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(web3.utils.utf8ToHex("UMATEST"));

    // Create a mockOracle and finder. Register the mockOracle with the finder.
    finder = await Finder.deployed();
    mockOracle = await MockOracle.new(finder.address, Timer.address);
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
      priceFeedIdentifier: web3.utils.utf8ToHex("UMATEST"),
      syntheticName: "Test UMA Token",
      syntheticSymbol: "UMATEST",
      liquidationLiveness: "10",
      collateralRequirement: { rawValue: toWei("1.5") },
      disputeBondPct: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPct: { rawValue: toWei("0.1") },
      disputerDisputeRewardPct: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") },
      timerAddress: Timer.address
    };

    emp = await ExpiringMultiParty.new(constructorParams);

    // The ExpiringMultiPartyEventClient does not emit any info level events. Therefore no need to test Winston outputs.
    dummyLogger = winston.createLogger({
      level: "info",
      transports: [new winston.transports.Console()]
    });

    client = new ExpiringMultiPartyEventClient(dummyLogger, ExpiringMultiParty.abi, web3, emp.address);
    await collateralToken.approve(emp.address, toWei("1000000"), { from: sponsor1 });
    await collateralToken.approve(emp.address, toWei("1000000"), { from: sponsor2 });
    await collateralToken.approve(emp.address, toWei("1000000"), { from: sponsor3 });

    syntheticToken = await Token.at(await emp.tokenCurrency());
    await syntheticToken.approve(emp.address, toWei("100000000"), { from: sponsor1 });
    await syntheticToken.approve(emp.address, toWei("100000000"), { from: sponsor2 });

    // Create two positions
    newSponsorTxObj1 = await emp.create({ rawValue: toWei("10") }, { rawValue: toWei("50") }, { from: sponsor1 });
    newSponsorTxObj2 = await emp.create({ rawValue: toWei("100") }, { rawValue: toWei("45") }, { from: sponsor2 });

    // Seed the liquidator position
    await collateralToken.approve(emp.address, toWei("1000000"), { from: liquidator });
    await syntheticToken.approve(emp.address, toWei("100000000"), { from: liquidator });
    newSponsorTxObj3 = await emp.create({ rawValue: toWei("500") }, { rawValue: toWei("200") }, { from: liquidator });
  });

  it("Return NewSponsor Events", async function() {
    // Update the client and check it has the new sponsor event stored correctly
    await client.clearState();
    await client.update();

    // Compare with expected processed event objects
    assert.deepStrictEqual(
      [
        {
          transactionHash: newSponsorTxObj1.tx,
          blockNumber: newSponsorTxObj1.receipt.blockNumber,
          sponsor: sponsor1,
          collateralAmount: toWei("10"),
          tokenAmount: toWei("50")
        },
        {
          transactionHash: newSponsorTxObj2.tx,
          blockNumber: newSponsorTxObj2.receipt.blockNumber,
          sponsor: sponsor2,
          collateralAmount: toWei("100"),
          tokenAmount: toWei("45")
        },
        {
          transactionHash: newSponsorTxObj3.tx,
          blockNumber: newSponsorTxObj3.receipt.blockNumber,
          sponsor: liquidator,
          collateralAmount: toWei("500"),
          tokenAmount: toWei("200")
        }
      ],
      client.getAllNewSponsorEvents()
    );

    // Correctly adds only new events after last query
    const newSponsorTxObj4 = await emp.create({ rawValue: toWei("10") }, { rawValue: toWei("1") }, { from: sponsor3 });
    await client.clearState();
    await client.update();

    assert.deepStrictEqual(
      [
        {
          transactionHash: newSponsorTxObj4.tx,
          blockNumber: newSponsorTxObj4.receipt.blockNumber,
          sponsor: sponsor3,
          collateralAmount: toWei("10"),
          tokenAmount: toWei("1")
        }
      ],
      client.getAllNewSponsorEvents()
    );
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
          lockedCollateral: toWei("10"),
          liquidatedCollateral: toWei("10")
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
          lockedCollateral: toWei("100"),
          liquidatedCollateral: toWei("100")
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
          disputeBondAmount: toWei("1") // 10% of the liquidated position's collateral.
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
    await mockOracle.pushPrice(web3.utils.utf8ToHex("UMATEST"), liquidationTime, disputePrice);

    const txObject = await emp.withdrawLiquidation("0", sponsor1, { from: liquidator });
    await client.clearState();

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
