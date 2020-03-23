const { toWei, utf8ToHex } = web3.utils;

// Script to test
const Poll = require('../index.js');
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

contract("Liquidator.js", function(accounts) {
  // implementation uses the 0th address by default as the bot runs using the default truffle wallet accounts[0]
  const liquidatorBot = accounts[0];
  const contractCreator = accounts[1];

  let collateralToken;
  let emp;
  let liquidator;
  let mockOracle;

  before(async function() {
    collateralToken = await Token.new({ from: contractCreator });
    await collateralToken.addMember(1, contractCreator, {
      from: contractCreator
    });

    // Create identifier whitelist and register the price tracking ticker with it.
    identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(utf8ToHex("UMATEST"));

    // Create a mockOracle and finder. Register the mockOracle with the finder.
    mockOracle = await MockOracle.new(identifierWhitelist.address, {
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

    // Deploy a new expiring multi party
    emp = await ExpiringMultiParty.new(constructorParams);

    // Create a new instance of the ExpiringMultiPartyClient & gasEstimator to construct the liquidator
    empClient = new ExpiringMultiPartyClient(ExpiringMultiParty.abi, web3, emp.address);
    gasEstimator = new GasEstimator();

    // Create a new instance of the liquidator to test
    liquidator = new Liquidator(empClient, gasEstimator, liquidatorBot);
  });

  it("Completes one iteration without throwing an error", async function () {
    const testConfig = {
        address: emp.address,
        price: "1"
    }
    let errorThrown;
    try {
        await Poll.run(testConfig);
        errorThrown = false
    } catch (err) {
        errorThrown = true;
    }
    assert.isFalse(errorThrown)
  })
});
