const { toWei } = web3.utils;

// Script to test
const { ContractMonitor } = require("../ContractMonitor");

// Helper client script
const { ExpiringMultiPartyEventClient } = require("../../financial-templates-lib/ExpiringMultiPartyEventClient");

const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const Finder = artifacts.require("Finder");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const MockOracle = artifacts.require("MockOracle");
const TokenFactory = artifacts.require("TokenFactory");
const Token = artifacts.require("ExpandedERC20");

contract("ContractMonitor.js", function(accounts) {
  const tokenSponsor = accounts[0];
  const liquidator = accounts[1];
  const disputer = accounts[2];
  const sponsor1 = accounts[3];
  const sponsor2 = accounts[4];

  const zeroAddress = "0x0000000000000000000000000000000000000000";

  // Contracts
  let collateralToken;
  let emp;
  let syntheticToken;
  let mockOracle;
  let identifierWhitelist;

  // Test object for EMP event client
  let eventClient;

  // re-used variables
  let expirationTime;
  let constructorParams;

  before(async function() {
    collateralToken = await Token.new({ from: tokenSponsor });
    await collateralToken.addMember(1, tokenSponsor, { from: tokenSponsor });
    for (let i = 1; i < 5; i++) {
      // For each of the first 5 accounts used
      await collateralToken.mint(accounts[i], toWei("100000"), { from: tokenSponsor });
      await collateralToken.mint(accounts[i], toWei("100000"), { from: tokenSponsor });
      await collateralToken.mint(accounts[i], toWei("100000"), { from: tokenSponsor });
    }

    identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(web3.utils.utf8ToHex("UMATEST"));

    // Create a mockOracle and finder. Register the mockOracle with the finder.
    mockOracle = await MockOracle.new(identifierWhitelist.address);
    finder = await Finder.deployed();
    const mockOracleInterfaceName = web3.utils.utf8ToHex("Oracle");
    await finder.changeImplementationAddress(mockOracleInterfaceName, mockOracle.address);
  });

  beforeEach(async function() {
    const currentTime = await mockOracle.getCurrentTime.call();
    expirationTime = currentTime.toNumber() + 100; // 100 seconds in the future

    constructorParams = {
      isTest: true,
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
      minSponsorTokens: { rawValue: toWei("1") }
    };

    emp = await ExpiringMultiParty.new(constructorParams);
    eventClient = new ExpiringMultiPartyEventClient(ExpiringMultiParty.abi, web3, emp.address);
    contractMonitor = new ContractMonitor(eventClient, accounts[0], accounts[1]);

    syntheticToken = await Token.at(await emp.tokenCurrency());

    //   Bulk approve for all wallets
    for (let i = 1; i < 5; i++) {
      await collateralToken.approve(emp.address, toWei("100000000"), { from: accounts[i] });
      await syntheticToken.approve(emp.address, toWei("100000000"), { from: accounts[i] });
    }

    // Create two positions for the sponsors
    await emp.create({ rawValue: toWei("10") }, { rawValue: toWei("50") }, { from: sponsor1 });
    await emp.create({ rawValue: toWei("100") }, { rawValue: toWei("45") }, { from: sponsor2 });

    // Create one position for the liquidator
    await emp.create({ rawValue: toWei("500") }, { rawValue: toWei("200") }, { from: liquidator });
  });

  it.only("Return Liquidation Events", async function() {
    // Create liquidation to liquidate sponsor2 from sponsor1
    const txObject1 = await emp.createLiquidation(
      sponsor1,
      { rawValue: toWei("99999") },
      { rawValue: toWei("100") },
      { from: liquidator }
    );

    // Update the eventClient and check it has the liquidation event stored correctly
    await eventClient.clearState();
    await eventClient._update();

    console.log("calling");
    awaitcontractMonitor.checkForNewLiquidations(time => toWei("1"));
    console.log("called");
    // // Compare with expected processed event object
    // assert.deepStrictEqual(
    //   [
    //     {
    //       transactionHash: txObject1.tx,
    //       blockNumber: txObject1.receipt.blockNumber,
    //       sponsor: sponsor1,
    //       liquidator: liquidator,
    //       liquidationId: "0",
    //       tokensOutstanding: toWei("50"),
    //       lockedCollateral: toWei("10"),
    //       liquidatedCollateral: toWei("10")
    //     }
    //   ],
    //   eventClient.getAllLiquidationEvents()
    // );

    // // Correctly adds a second event after creating a new liquidation
    // const txObject2 = await emp.createLiquidation(
    //   sponsor2,
    //   { rawValue: toWei("99999") },
    //   { rawValue: toWei("100") },
    //   { from: liquidator }
    // );
    // await eventClient.clearState();
    // await eventClient._update();
    // console.log()
  });

  //   it("Return Dispute Events", async function() {
  //     // Create liquidation to liquidate sponsor2 from sponsor1
  //     await emp.createLiquidation(
  //       sponsor1,
  //       { rawValue: toWei("99999") },
  //       { rawValue: toWei("100") },
  //       { from: liquidator }
  //     );

  //     const txObject = await emp.dispute("0", sponsor1, { from: sponsor2 });

  //     // Update the eventClient and check it has the dispute event stored correctly
  //     await eventClient.clearState();
  //     await eventClient._update();

  //     // Compare with expected processed event object
  //     assert.deepStrictEqual(
  //       [
  //         {
  //           transactionHash: txObject.tx,
  //           blockNumber: txObject.receipt.blockNumber,
  //           sponsor: sponsor1,
  //           liquidator: liquidator,
  //           disputer: sponsor2,
  //           liquidationId: "0",
  //           disputeBondAmount: toWei("1") // 10% of the liquidated position's collateral.
  //         }
  //       ],
  //       eventClient.getAllDisputeEvents()
  //     );
  //   });
  //   it("Return Dispute Settlement Events", async function() {
  //     // Create liquidation to liquidate sponsor2 from sponsor1
  //     const liquidationTime = (await emp.getCurrentTime()).toNumber();
  //     await emp.createLiquidation(
  //       sponsor1,
  //       { rawValue: toWei("99999") },
  //       { rawValue: toWei("100") },
  //       { from: liquidator }
  //     );

  //     // Dispute the position from the second sponsor
  //     await emp.dispute("0", sponsor1, {
  //       from: sponsor2
  //     });

  //     // Advance time and settle
  //     const timeAfterLiquidationLiveness = liquidationTime + 10;
  //     await mockOracle.setCurrentTime(timeAfterLiquidationLiveness.toString());
  //     await emp.setCurrentTime(timeAfterLiquidationLiveness.toString());

  //     // Force a price such that the dispute fails, and then withdraw from the unsuccessfully
  //     // disputed liquidation.
  //     const disputePrice = toWei("1.6");
  //     await mockOracle.pushPrice(web3.utils.utf8ToHex("UMATEST"), liquidationTime, disputePrice);

  //     const txObject = await emp.withdrawLiquidation("0", sponsor1, { from: liquidator });
  //     await eventClient.clearState();

  //     // Update the eventClient and check it has the dispute event stored correctly
  //     await eventClient._update();

  //     // Compare with expected processed event object
  //     assert.deepStrictEqual(
  //       [
  //         {
  //           transactionHash: txObject.tx,
  //           blockNumber: txObject.receipt.blockNumber,
  //           caller: liquidator,
  //           sponsor: sponsor1,
  //           liquidator: liquidator,
  //           disputer: sponsor2,
  //           liquidationId: "0",
  //           disputeSucceeded: false // Settlement price makes liquidation valid
  //         }
  //       ],
  //       eventClient.getAllDisputeSettlementEvents()
  //     );
  //   });
});
