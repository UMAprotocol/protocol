const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract } = hre;
const { toWei, padRight, utf8ToHex } = web3.utils;

// Tested Contract
const Perpetual = getContract("Perpetual");

// Helper Contracts
const Finder = getContract("Finder");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const Token = getContract("SyntheticToken");
const Timer = getContract("Timer");
const ConfigStore = getContract("ConfigStore");

describe("Perpetual", function () {
  let finder, timer, accounts;

  before(async () => {
    await runDefaultFixture(hre);
    accounts = await web3.eth.getAccounts();
    timer = await Timer.deployed();
    finder = await Finder.deployed();
  });

  it("Can deploy", async function () {
    const collateralToken = await Token.new("Wrapped Ether", "WETH", 18).send({ from: accounts[0] });
    const tokenCurrency = await Token.new("Test Synthetic Token", "SYNTH", 18).send({ from: accounts[0] });
    const configStore = await ConfigStore.new(
      {
        timelockLiveness: 86400, // 1 day
        rewardRatePerSecond: { rawValue: "0" },
        proposerBondPercentage: { rawValue: "0" },
        maxFundingRate: { rawValue: "0" },
        minFundingRate: { rawValue: "0" },
        proposalTimePastLimit: 0,
      },
      timer.options.address
    ).send({ from: accounts[0] });

    const constructorParams = {
      withdrawalLiveness: "1000",
      collateralAddress: collateralToken.options.address,
      tokenAddress: tokenCurrency.options.address,
      finderAddress: finder.options.address,
      priceFeedIdentifier: padRight(utf8ToHex("TEST_IDENTIFIER"), 64),
      fundingRateIdentifier: padRight(utf8ToHex("TEST_FUNDING"), 64),
      liquidationLiveness: "1000",
      collateralRequirement: { rawValue: toWei("1.5") },
      disputeBondPercentage: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPercentage: { rawValue: toWei("0.1") },
      disputerDisputeRewardPercentage: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") },
      timerAddress: timer.options.address,
      configStoreAddress: configStore.options.address,
      tokenScaling: { rawValue: toWei("1") },
    };

    const identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.methods
      .addSupportedIdentifier(constructorParams.priceFeedIdentifier)
      .send({ from: accounts[0] });

    await Perpetual.new(constructorParams).send({ from: accounts[0] });
  });
});
