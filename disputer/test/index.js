const { toWei, utf8ToHex } = web3.utils;

// Script to test
const Poll = require("../index.js");
const { Disputer } = require("../disputer.js");

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

contract("Disputer.js", function(accounts) {
  const disputeBot = accounts[0];
  const contractCreator = accounts[1];

  let collateralToken;
  let emp;
  let mockOracle;

  before(async function() {
    collateralToken = await Token.new({ from: contractCreator });
    await collateralToken.addMember(1, contractCreator, {
      from: contractCreator
    });

    // Create a mockOracle and finder. Register the mockMoracle with the finder.
    mockOracle = await MockOracle.new(IdentifierWhitelist.address, {
      from: contractCreator
    });
    finder = await Finder.deployed();
    const mockOracleInterfaceName = utf8ToHex("Oracle");
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

    // Create a new instance of the ExpiringMultiPartyClient & GasEstimator to construct the disputer
    empClient = new ExpiringMultiPartyClient(ExpiringMultiParty.abi, web3, emp.address);
    gasEstimator = new GasEstimator();

    // Create a new instance of the disputer to test
    disputer = new Disputer(empClient, gasEstimator, disputeBot);
  });

  it("Completes one iteration without throwing an error", async function() {
    const address = emp.address;
    const price = "1";
    let errorThrown;
    try {
      await Poll.run(price, address, false);
      errorThrown = false;
    } catch (err) {
      console.error(err);
      errorThrown = true;
    }
    assert.isFalse(errorThrown);
  });
});
