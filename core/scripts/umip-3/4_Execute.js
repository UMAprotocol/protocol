// This script is used to execute some basic operations on the DVM after the 1_Propose, 2_VoteSimulate, 3_Verify flow is
//  compleat.

const assert = require("assert").strict;

const Token = artifacts.require("ExpandedERC20");
const Finder = artifacts.require("Finder");
const Registry = artifacts.require("Registry");
const Voting = artifacts.require("Voting");
const Store = artifacts.require("Store");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const Governor = artifacts.require("Governor");
const FinancialContractsAdmin = artifacts.require("FinancialContractsAdmin");

const { interfaceName } = require("../../utils/Constants.js");

const publicNetworks = require("../../../common/PublicNetworks.js");

const foundationWallet = "0x7a3A1c2De64f20EB5e916F40D11B01C441b2A8Dc";
const largeDaiTokenHolder = "0xdcc983d7539f6ce596946d2a09a0ba74a36b4822";

const ownerRole = "0";

// New addresses of ecosystem components after porting from `Propose.js`
const upgradeAddresses = {
  Voting: "0x7492cdbc126ffc05c32249a470982173870e95b0",
  Registry: "0x46209e15a14f602897e6d72da858a6ad806403f1",
  Store: "0x74d367e2207e52f05963479e8395cf44909f075b",
  FinancialContractsAdmin: "0x3b99859be43d543960803c09a0247106e82e74ee",
  IdentifierWhitelist: "0x9e39424eab9161cc3399d886b1428cba71586cb8",
  Governor: "0x878cfedb234c226ddefd33657937af74c17628bf",
  Finder: "0x40f941E48A552bF496B154Af6bf55725f18D77c3" // Finder was no upgraded in UMIP3
};

async function runExport() {
  // 1. Registering a new NFCT

  collateralToken = await Token.at(publicNetworks[1].daiAddress);
  console.log("collateralToken", collateralToken.address);

  //   registry = await Registry.deployed();
  //   expiringMultiPartyCreator = await ExpiringMultiPartyCreator.deployed();
  //   await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, expiringMultiPartyCreator.address, {
  //     from: contractCreator
  //   });

  //   // Whitelist collateral currency
  //   collateralTokenWhitelist = await AddressWhitelist.at(await expiringMultiPartyCreator.collateralTokenWhitelist());
  //   await collateralTokenWhitelist.addToWhitelist(collateralToken.address, { from: contractCreator });

  //   constructorParams = {
  //     expirationTimestamp: (await expiringMultiPartyCreator.VALID_EXPIRATION_TIMESTAMPS(0)).toString(),
  //     collateralAddress: collateralToken.address,
  //     priceFeedIdentifier: web3.utils.utf8ToHex("UMATEST"),
  //     syntheticName: "Test UMA Token",
  //     syntheticSymbol: "UMATEST",
  //     collateralRequirement: { rawValue: toWei("1.5") },
  //     disputeBondPct: { rawValue: toWei("0.1") },
  //     sponsorDisputeRewardPct: { rawValue: toWei("0.1") },
  //     disputerDisputeRewardPct: { rawValue: toWei("0.1") },
  //     minSponsorTokens: { rawValue: toWei("1") },
  //     timerAddress: Timer.address
  //   };

  //   identifierWhitelist = await IdentifierWhitelist.deployed();
  //   await identifierWhitelist.addSupportedIdentifier(constructorParams.priceFeedIdentifier, {
  //     from: contractCreator
  //   });

  //   await expiringMultiPartyCreator.createExpiringMultiParty(constructorParams, {
  //     from: contractCreator
  //   });
}

run = async function(callback) {
  try {
    await runExport();
  } catch (err) {
    callback(err);
    return;
  }
  callback();
};

// Attach this function to the exported function in order to allow the script to be executed through both truffle and a test runner.
run.runExport = runExport;
module.exports = run;
