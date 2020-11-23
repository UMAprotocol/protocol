const { ZERO_ADDRESS } = require("@uma/common");
const { toWei } = web3.utils;

// Tested Contract
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");

// Helper Contracts
const Finder = artifacts.require("Finder");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const Token = artifacts.require("ExpandedERC20");
const Timer = artifacts.require("Timer");

contract("ExpiringMultiParty", function(accounts) {
  let finder, timer;

  beforeEach(async () => {
    timer = await Timer.deployed();
    finder = await Finder.deployed();
  });

  it("Can deploy", async function() {
    const collateralToken = await Token.new("Wrapped Ether", "WETH", 18, { from: accounts[0] });
    const syntheticToken = await Token.new("Test Synthetic Token", "SYNTH", 18, { from: accounts[0] });

    const constructorParams = {
      expirationTimestamp: (Math.round(Date.now() / 1000) + 1000).toString(),
      withdrawalLiveness: "1000",
      collateralAddress: collateralToken.address,
      tokenAddress: syntheticToken.address,
      finderAddress: finder.address,
      priceFeedIdentifier: web3.utils.utf8ToHex("TEST_IDENTIFIER"),
      liquidationLiveness: "1000",
      collateralRequirement: { rawValue: toWei("1.5") },
      disputeBondPct: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPct: { rawValue: toWei("0.1") },
      disputerDisputeRewardPct: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") },
      timerAddress: timer.address,
      excessTokenBeneficiary: accounts[0],
      financialProductLibraryAddress: ZERO_ADDRESS
    };

    const identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(constructorParams.priceFeedIdentifier, {
      from: accounts[0]
    });

    await ExpiringMultiParty.new(constructorParams);
  });
});
