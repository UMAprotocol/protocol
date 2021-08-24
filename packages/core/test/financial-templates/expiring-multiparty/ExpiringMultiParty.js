const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract } = hre;
const { ZERO_ADDRESS } = require("@uma/common");
const { toWei, padRight, utf8ToHex } = web3.utils;

// Tested Contract
const ExpiringMultiParty = getContract("ExpiringMultiParty");

// Helper Contracts
const Finder = getContract("Finder");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const Token = getContract("ExpandedERC20");
const Timer = getContract("Timer");

describe("ExpiringMultiParty", function () {
  let finder, timer;
  let accounts;

  before(async () => {
    // Accounts.
    accounts = await web3.eth.getAccounts();
    await runDefaultFixture(hre);
    timer = await Timer.deployed();
    finder = await Finder.deployed();
  });

  it("Can deploy", async function () {
    const collateralToken = await Token.new("Wrapped Ether", "WETH", 18).send({ from: accounts[0] });
    const syntheticToken = await Token.new("Test Synthetic Token", "SYNTH", 18).send({ from: accounts[0] });
    const currentTime = Number(await timer.methods.getCurrentTime().call());

    const constructorParams = {
      expirationTimestamp: (currentTime + 1000).toString(),
      withdrawalLiveness: "1000",
      collateralAddress: collateralToken.options.address,
      tokenAddress: syntheticToken.options.address,
      finderAddress: finder.options.address,
      priceFeedIdentifier: padRight(utf8ToHex("TEST_IDENTIFIER"), 64),
      liquidationLiveness: "1000",
      collateralRequirement: { rawValue: toWei("1.5") },
      disputeBondPercentage: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPercentage: { rawValue: toWei("0.1") },
      disputerDisputeRewardPercentage: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") },
      timerAddress: timer.options.address,
      financialProductLibraryAddress: ZERO_ADDRESS,
    };

    const identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.methods
      .addSupportedIdentifier(constructorParams.priceFeedIdentifier)
      .send({ from: accounts[0] });

    await ExpiringMultiParty.new(constructorParams).send({ from: accounts[0] });
  });
});
