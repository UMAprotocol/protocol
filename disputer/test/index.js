const { toWei, utf8ToHex } = web3.utils;

// Script to test
const Poll = require("../index.js");

// Contracts and helpers
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const Finder = artifacts.require("Finder");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const Token = artifacts.require("ExpandedERC20");
const TokenFactory = artifacts.require("TokenFactory");

contract("index.js", function(accounts) {
  const contractCreator = accounts[0];

  let emp;
  let collateralToken;

  before(async function() {
    collateralToken = await Token.new({ from: contractCreator });

    // Create identifier whitelist and register the price tracking ticker with it.
    identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(utf8ToHex("UMATEST"));
  });

  beforeEach(async function() {
    collateralToken = await Token.new({ from: contractCreator });

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
      disputerDisputeRewardPct: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") }
    };

    // Deploy a new expiring multi party
    emp = await ExpiringMultiParty.new(constructorParams);
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
