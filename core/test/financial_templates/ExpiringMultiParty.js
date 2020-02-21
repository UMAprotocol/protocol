const { toWei } = web3.utils;

// Tested Contract
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");

// Helper Contracts
const Finder = artifacts.require("Finder");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const TokenFactory = artifacts.require("TokenFactory");
const ERC20MintableData = require("@openzeppelin/contracts/build/contracts/ERC20Mintable.json");
const truffleContract = require("@truffle/contract");
const ERC20Mintable = truffleContract(ERC20MintableData);
ERC20Mintable.setProvider(web3.currentProvider);

contract("ExpiringMultiParty", function(accounts) {
  it("Can deploy", async function() {
    const collateralToken = await ERC20Mintable.new({ from: accounts[0] });

    const constructorParams = {
      isTest: true,
      expirationTimestamp: "1234567890",
      withdrawalLiveness: "1000",
      collateralAddress: collateralToken.address,
      finderAddress: Finder.address,
      tokenFactoryAddress: TokenFactory.address,
      priceFeedIdentifier: web3.utils.utf8ToHex("UMATEST"),
      syntheticName: "Test UMA Token",
      syntheticSymbol: "UMATEST",
      liquidationLiveness: "1000",
      collateralRequirement: { rawValue: toWei("1.5") },
      disputeBondPct: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPct: { rawValue: toWei("0.1") },
      disputerDisputeRewardPct: { rawValue: toWei("0.1") }
    };

    identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(constructorParams.priceFeedIdentifier, {
      from: accounts[0]
    });

    // Register the identifer white list with the finder as well
    const identifierWhitelistName = web3.utils.utf8ToHex("IdentifierWhitelist");
    await finder.changeImplementationAddress(identifierWhitelistName, identifierWhitelist.address, {
      from: accounts[0]
    });

    await ExpiringMultiParty.new(constructorParams);
  });
});
