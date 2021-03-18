const { toWei, padRight, utf8ToHex } = web3.utils;

// Tested Contract
const Perpetual = artifacts.require("Perpetual");

// Helper Contracts
const Finder = artifacts.require("Finder");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const Token = artifacts.require("SyntheticToken");
const Timer = artifacts.require("Timer");
const ConfigStore = artifacts.require("ConfigStore");

contract("Perpetual", function(accounts) {
  let finder, timer;

  beforeEach(async () => {
    timer = await Timer.deployed();
    finder = await Finder.deployed();
  });

  it("Can deploy", async function() {
    const collateralToken = await Token.new("Wrapped Ether", "WETH", 18, { from: accounts[0] });
    const tokenCurrency = await Token.new("Test Synthetic Token", "SYNTH", 18, { from: accounts[0] });
    const configStore = await ConfigStore.new(
      {
        timelockLiveness: 86400, // 1 day
        rewardRatePerSecond: { rawValue: "0" },
        proposerBondPercentage: { rawValue: "0" },
        maxFundingRate: { rawValue: "0" },
        minFundingRate: { rawValue: "0" },
        proposalTimePastLimit: 0
      },
      timer.address
    );

    const constructorParams = {
      withdrawalLiveness: "1000",
      collateralAddress: collateralToken.address,
      tokenAddress: tokenCurrency.address,
      finderAddress: finder.address,
      priceFeedIdentifier: padRight(utf8ToHex("TEST_IDENTIFIER"), 64),
      fundingRateIdentifier: padRight(utf8ToHex("TEST_FUNDING_IDENTIFIER"), 64),
      liquidationLiveness: "1000",
      collateralRequirement: { rawValue: toWei("1.5") },
      disputeBondPercentage: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPercentage: { rawValue: toWei("0.1") },
      disputerDisputeRewardPercentage: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") },
      timerAddress: timer.address,
      configStoreAddress: configStore.address,
      tokenScaling: { rawValue: toWei("1") }
    };

    const identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(constructorParams.priceFeedIdentifier, {
      from: accounts[0]
    });

    await Perpetual.new(constructorParams);
  });
});
