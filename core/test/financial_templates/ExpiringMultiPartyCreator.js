const { toWei } = web3.utils;

const truffleAssert = require("truffle-assertions");
const { RegistryRolesEnum } = require("../../../common/Enums.js");

// Tested Contract
const ExpiringMultiPartyCreator = artifacts.require("ExpiringMultiPartyCreator");

// Helper Contracts
const Finder = artifacts.require("Finder");
const ERC20MintableData = require("@openzeppelin/contracts/build/contracts/ERC20Mintable.json");
const truffleContract = require("@truffle/contract");
const ERC20Mintable = truffleContract(ERC20MintableData);
const TokenFactory = artifacts.require("TokenFactory");
const Registry = artifacts.require("Registry");
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");

ERC20Mintable.setProvider(web3.currentProvider);

contract("ExpiringMultiParty", function(accounts) {
  let collateralToken;
  let finder;
  let expiringMultiPartyCreator;

  beforeEach(async () => {
    collateralToken = await ERC20Mintable.new({ from: accounts[0] });
    finder = await Finder.deployed();
    registry = await Registry.deployed();

    expiringMultiPartyCreator = await ExpiringMultiPartyCreator.new(true, finder.address, { from: accounts[0] });

    await registry.addMember(RegistryRolesEnum.DERIVATIVE_CREATOR, expiringMultiPartyCreator.address, {
      from: accounts[0]
    });
  });

  it("Can create new instances of ExpiringMultiParty", async function() {
    const constructorParams = {
      isTest: true,
      expirationTimestamp: "1234567890",
      withdrawalLiveness: "1000",
      collateralAddress: collateralToken.address,
      finderAddress: finder.address,
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

    let createdAddressResult = await expiringMultiPartyCreator.createExpiringMultiParty(constructorParams, {
      from: accounts[0]
    });

    // Catch the address of the new multiparty contract from the event. Ensure that the assigned party member
    // is correct.
    let expiringMultiPartyAddress;
    truffleAssert.eventEmitted(createdAddressResult, "CreatedExpiringMultiParty", ev => {
      expiringMultiPartyAddress = ev.expiringMultiPartyAddress;
      return ev.expiringMultiPartyAddress != 0 && ev.partyMemberAddress == accounts[0];
    });

    // Instantiate an instance of the expiringMultiParty and check a few constants that should hold true
    let expiringMultiParty = await ExpiringMultiParty.at(expiringMultiPartyAddress);
    assert(await expiringMultiParty.expirationTimestamp(), constructorParams.expirationTimestamp);
    assert(await expiringMultiParty.withdrawalLiveness(), constructorParams.withdrawalLiveness);
    assert(await expiringMultiParty.priceIdentifer(), constructorParams.priceFeedIdentifier);
  });
});
