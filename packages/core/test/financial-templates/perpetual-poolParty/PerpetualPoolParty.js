const { toWei } = web3.utils;

// Tested Contract
const PerpetualPoolParty = artifacts.require("PerpetualPoolParty");

// Helper Contracts
const Finder = artifacts.require("Finder");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const Token = artifacts.require("SyntheticToken");
const Timer = artifacts.require("Timer");
const FeePayerPoolPartyLib = artifacts.require("FeePayerPoolPartyLib");
const PerpetualPositionManagerPoolPartyLib = artifacts.require("PerpetualPositionManagerPoolPartyLib");
const PerpetualLiquidatablePoolPartyLib = artifacts.require("PerpetualLiquidatablePoolPartyLib");

contract("PerpetualPoolParty", function(accounts) {
  let finder, timer;

  beforeEach(async () => {
    timer = await Timer.deployed();
    finder = await Finder.deployed();
  });

  it("Can deploy", async function() {
    const collateralToken = await Token.new("UMA", "UMA", 18, { from: accounts[0] });
    const syntheticToken = await Token.new("SYNTH", "SYNTH", 18, { from: accounts[0] });

    const positionManagerParams = {
      withdrawalLiveness: "1000",
      collateralAddress: collateralToken.address,
      tokenAddress: syntheticToken.address,
      finderAddress: finder.address,
      priceFeedIdentifier: web3.utils.utf8ToHex("UMATEST"),
      minSponsorTokens: { rawValue: toWei("1") },
      timerAddress: timer.address,
      excessTokenBeneficiary: accounts[0]
    };

    const roles = {
      admins: [accounts[1]],
      tokenSponsors: [accounts[1]]
    };

    const liquidatableParams = {
      liquidationLiveness: "1000",
      collateralRequirement: { rawValue: toWei("1.5") },
      disputeBondPct: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPct: { rawValue: toWei("0.1") },
      disputerDisputeRewardPct: { rawValue: toWei("0.1") }
    };

    const constructorParams = {
      positionManagerParams,
      roles,
      liquidatableParams
    };

    const identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(constructorParams.positionManagerParams.priceFeedIdentifier, {
      from: accounts[0]
    });
    const feePayerPoolPartyLib = await FeePayerPoolPartyLib.deployed();
    const perpetualPositionManagerPoolPartyLib = await PerpetualPositionManagerPoolPartyLib.deployed();
    const perpetualLiquidatablePoolPartyLib = await PerpetualLiquidatablePoolPartyLib.deployed();
    if (
      FeePayerPoolPartyLib.setAsDeployed ||
      PerpetualPositionManagerPoolPartyLib.setAsDeployed ||
      PerpetualLiquidatablePoolPartyLib.setAsDeployed
    ) {
      try {
        await PerpetualPoolParty.link(feePayerPoolPartyLib);
        await PerpetualPoolParty.link(perpetualPositionManagerPoolPartyLib);
        await PerpetualPoolParty.link(perpetualLiquidatablePoolPartyLib);
      } catch (e) {
        // Allow this to fail in the Buidler case.
      }
    } else {
      // Truffle
      await PerpetualPoolParty.link(FeePayerPoolPartyLib, feePayerPoolPartyLib.address);
      await PerpetualPoolParty.link(PerpetualPositionManagerPoolPartyLib, perpetualPositionManagerPoolPartyLib.address);
      await PerpetualPoolParty.link(PerpetualLiquidatablePoolPartyLib, perpetualLiquidatablePoolPartyLib.address);
    }
    await PerpetualPoolParty.new(constructorParams);
  });
});
