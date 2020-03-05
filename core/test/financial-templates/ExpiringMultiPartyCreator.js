const { toWei, hexToUtf8 } = web3.utils;

const truffleAssert = require("truffle-assertions");
const { RegistryRolesEnum } = require("../../../common/Enums.js");

// Tested Contract
const ExpiringMultiPartyCreator = artifacts.require("ExpiringMultiPartyCreator");

// Helper Contracts
const Finder = artifacts.require("Finder");
const Token = artifacts.require("ExpandedERC20");
const TokenFactory = artifacts.require("TokenFactory");
const Registry = artifacts.require("Registry");
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");

contract("ExpiringMultiParty", function(accounts) {
  let contractCreator = accounts[0];

  // Contract variables
  let collateralToken;
  let expiringMultiPartyCreator;
  let registry;

  // Re-used variables
  let constructorParams;

  beforeEach(async () => {
    collateralToken = await Token.new({ from: contractCreator });
    registry = await Registry.deployed();
    expiringMultiPartyCreator = await ExpiringMultiPartyCreator.deployed();

    await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, expiringMultiPartyCreator.address, {
      from: contractCreator
    });

    constructorParams = {
      expirationTimestamp: "1234567890",
      withdrawalLiveness: "1000",
      siphonDelay: "100000",
      collateralAddress: collateralToken.address,
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
      from: contractCreator
    });
  });

  it("Can create new instances of ExpiringMultiParty", async function() {
    // Use `.call` to get the returned value from the function.
    let functionReturnedAddress = await expiringMultiPartyCreator.createExpiringMultiParty.call(constructorParams, {
      from: contractCreator
    });

    // Execute without the `.call` to perform state change. catch the result to query the event.
    let createdAddressResult = await expiringMultiPartyCreator.createExpiringMultiParty(constructorParams, {
      from: contractCreator
    });

    // Catch the address of the new contract from the event. Ensure that the assigned party member is correct.
    let expiringMultiPartyAddress;
    truffleAssert.eventEmitted(createdAddressResult, "CreatedExpiringMultiParty", ev => {
      expiringMultiPartyAddress = ev.expiringMultiPartyAddress;
      return ev.expiringMultiPartyAddress != 0 && ev.partyMemberAddress == contractCreator;
    });

    // Ensure value returned from the event is the same as returned from the function
    assert.equal(functionReturnedAddress, expiringMultiPartyAddress);

    // Instantiate an instance of the expiringMultiParty and check a few constants that should hold true
    let expiringMultiParty = await ExpiringMultiParty.at(expiringMultiPartyAddress);
    assert.equal(await expiringMultiParty.expirationTimestamp(), constructorParams.expirationTimestamp);
    assert.equal(await expiringMultiParty.withdrawalLiveness(), constructorParams.withdrawalLiveness);
    assert.equal(
      hexToUtf8(await expiringMultiParty.priceIdentifer()),
      hexToUtf8(constructorParams.priceFeedIdentifier)
    );
  });

  it("Creation correctly registers ExpiringMultiParty within the registry", async function() {
    let createdAddressResult = await expiringMultiPartyCreator.createExpiringMultiParty(constructorParams, {
      from: contractCreator
    });

    let expiringMultiPartyAddress;
    truffleAssert.eventEmitted(createdAddressResult, "CreatedExpiringMultiParty", ev => {
      expiringMultiPartyAddress = ev.expiringMultiPartyAddress;
      return ev.expiringMultiPartyAddress != 0 && ev.partyMemberAddress == contractCreator;
    });
    assert.isTrue(await registry.isContractRegistered(expiringMultiPartyAddress));
    assert.isTrue(await registry.isPartyMemberOfContract(contractCreator, expiringMultiPartyAddress));
  });
});
