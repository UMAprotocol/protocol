const { ZERO_ADDRESS } = require("@uma/common");
const { toWei, padRight, utf8ToHex } = web3.utils;

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
    const currentTime = (await timer.getCurrentTime()).toNumber();

    const constructorParams = {
      expirationTimestamp: (currentTime + 1000).toString(),
      withdrawalLiveness: "1000",
      collateralAddress: collateralToken.address,
      tokenAddress: syntheticToken.address,
      finderAddress: finder.address,
      priceFeedIdentifier: padRight(utf8ToHex("TEST_IDENTIFIER"), 64),
      liquidationLiveness: "1000",
      collateralRequirement: { rawValue: toWei("1.5") },
      disputeBondPercentage: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPercentage: { rawValue: toWei("0.1") },
      disputerDisputeRewardPercentage: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") },
      timerAddress: timer.address,
      financialProductLibraryAddress: ZERO_ADDRESS
    };

    const identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(constructorParams.priceFeedIdentifier, {
      from: accounts[0]
    });

    await ExpiringMultiParty.new(constructorParams);
  });
});
