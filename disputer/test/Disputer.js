const { toWei, utf8ToHex } = web3.utils;

// Script to test
const { Disputer } = require("../disputer.js");

// Helper client script
const { ExpiringMultiPartyClient } = require("../../financial-templates-lib/ExpiringMultiPartyClient");

// Contracts and helpers
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const Finder = artifacts.require("Finder");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const MockOracle = artifacts.require("MockOracle");
const TokenFactory = artifacts.require("TokenFactory");
const Token = artifacts.require("ExpandedERC20");

contract("Disputer.js", function(accounts) {
  const disputeBot = accounts[0];
  const sponsor1 = accounts[1];
  const sponsor2 = accounts[2];
  const sponsor3 = accounts[3];
  const liquidator = accounts[4];
  const contractCreator = accounts[5];

  let collateralToken;
  let emp;
  let syntheticToken;
  let mockOracle;

  // States for Liquidation to be in
  const STATES = {
    UNINITIALIZED: "0",
    PRE_DISPUTE: "1",
    PENDING_DISPUTE: "2",
    DISPUTE_SUCCEEDED: "3",
    DISPUTE_FAILED: "4"
  };

  before(async function() {
    collateralToken = await Token.new({ from: contractCreator });
    await collateralToken.addMember(1, contractCreator, {
      from: contractCreator
    });

    // Seed the accounts.
    await collateralToken.mint(sponsor1, toWei("100000"), { from: contractCreator });
    await collateralToken.mint(sponsor2, toWei("100000"), { from: contractCreator });
    await collateralToken.mint(sponsor3, toWei("100000"), { from: contractCreator });
    await collateralToken.mint(liquidator, toWei("100000"), { from: contractCreator });
    await collateralToken.mint(disputeBot, toWei("100000"), { from: contractCreator });

    // Create a mockOracle and finder. Register the mockMoracle with the finder.
    mockOracle = await MockOracle.new(IdentifierWhitelist.address, {
      from: contractCreator
    });
    finder = await Finder.deployed();
    const mockOracleInterfaceName = web3.utils.utf8ToHex("Oracle");
    await finder.changeImplementationAddress(mockOracleInterfaceName, mockOracle.address);
  });

  beforeEach(async function() {
    const constructorParams = {
      isTest: true,
      expirationTimestamp: "12345678900",
      withdrawalLiveness: "1000",
      collateralAddress: collateralToken.address,
      finderAddress: Finder.address,
      tokenFactoryAddress: TokenFactory.address,
      priceFeedIdentifier: utf8ToHex("UMATEST"),
      syntheticName: "Test UMA Token",
      syntheticSymbol: "UMATEST",
      liquidationLiveness: "1000",
      collateralRequirement: { rawValue: toWei("1.2") },
      disputeBondPct: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPct: { rawValue: toWei("0.1") },
      disputerDisputeRewardPct: { rawValue: toWei("0.1") }
    };

    identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(constructorParams.priceFeedIdentifier, {
      from: accounts[0]
    });

    // Deploy a new expiring multi party
    emp = await ExpiringMultiParty.new(constructorParams);

    await collateralToken.approve(emp.address, toWei("100000000"), { from: sponsor1 });
    await collateralToken.approve(emp.address, toWei("100000000"), { from: sponsor2 });
    await collateralToken.approve(emp.address, toWei("100000000"), { from: sponsor3 });
    await collateralToken.approve(emp.address, toWei("100000000"), { from: liquidator });
    await collateralToken.approve(emp.address, toWei("100000000"), { from: disputeBot });

    syntheticToken = await Token.at(await emp.tokenCurrency());
    await syntheticToken.approve(emp.address, toWei("100000000"), { from: sponsor1 });
    await syntheticToken.approve(emp.address, toWei("100000000"), { from: sponsor2 });
    await syntheticToken.approve(emp.address, toWei("100000000"), { from: sponsor3 });
    await syntheticToken.approve(emp.address, toWei("100000000"), { from: liquidator });
    await syntheticToken.approve(emp.address, toWei("100000000"), { from: disputeBot });

    // Create a new instance of the ExpiringMultiPartyClient to construct the disputer
    empClient = new ExpiringMultiPartyClient(ExpiringMultiParty.abi, web3, emp.address);

    // Create a new instance of the disputer to test
    disputer = new Disputer(empClient, accounts[0]);
  });

  it("Detect disputable positions and send dipsutes", async function() {
    // sponsor1 creates a position with 125 units of collateral, creating 100 synthetic tokens.
    await emp.create({ rawValue: toWei("125") }, { rawValue: toWei("100") }, { from: sponsor1 });

    // sponsor2 creates a position with 150 units of collateral, creating 100 synthetic tokens.
    await emp.create({ rawValue: toWei("150") }, { rawValue: toWei("100") }, { from: sponsor2 });

    // sponsor3 creates a position with 175 units of collateral, creating 100 synthetic tokens.
    await emp.create({ rawValue: toWei("175") }, { rawValue: toWei("100") }, { from: sponsor3 });

    // The liquidator creates a position to have synthetic tokens.
    await emp.create({ rawValue: toWei("1000") }, { rawValue: toWei("500") }, { from: liquidator });

    await emp.createLiquidation(
      sponsor1,
      { rawValue: toWei("1.75") },
      { rawValue: toWei("100") },
      { from: liquidator }
    );
    await emp.createLiquidation(
      sponsor2,
      { rawValue: toWei("1.75") },
      { rawValue: toWei("100") },
      { from: liquidator }
    );
    await emp.createLiquidation(
      sponsor3,
      { rawValue: toWei("1.75") },
      { rawValue: toWei("100") },
      { from: liquidator }
    );

    // Start with a mocked price of 1.75 usd per token.
    // This makes all sponsors undercollateralized, meaning no disputes are issued.
    await disputer.queryAndDispute(time => toWei("1.75"));

    // There should be no liquidations created from any sponsor account
    assert.equal((await emp.getLiquidations(sponsor1))[0].state, STATES.PRE_DISPUTE);
    assert.equal((await emp.getLiquidations(sponsor2))[0].state, STATES.PRE_DISPUTE);
    assert.equal((await emp.getLiquidations(sponsor3))[0].state, STATES.PRE_DISPUTE);

    // With a price of 1.1, two sponsors should be correctly collateralized, so disputes should be issued against sponsor2 and sponsor3's liquidations.
    await disputer.queryAndDispute(time => toWei("1.1"));

    // Sponsor2 and sponsor3 should be disputed.
    assert.equal((await emp.getLiquidations(sponsor1))[0].state, STATES.PRE_DISPUTE);
    assert.equal((await emp.getLiquidations(sponsor2))[0].state, STATES.PENDING_DISPUTE);
    assert.equal((await emp.getLiquidations(sponsor3))[0].state, STATES.PENDING_DISPUTE);

    // The disputeBot should be the disputer in sponsor2 and sponsor3's liquidations.
    assert.equal((await emp.getLiquidations(sponsor2))[0].disputer, disputeBot);
    assert.equal((await emp.getLiquidations(sponsor3))[0].disputer, disputeBot);
  });
});
