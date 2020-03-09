const { toWei, hexToUtf8, toBN } = web3.utils;
const { didContractThrow } = require("../../../common/SolidityTestUtils.js");
const truffleAssert = require("truffle-assertions");
const { RegistryRolesEnum } = require("../../../common/Enums.js");

// Tested Contract
const ExpiringMultiPartyCreator = artifacts.require("ExpiringMultiPartyCreator");

// Helper Contracts
const Token = artifacts.require("ExpandedERC20");
const TokenFactory = artifacts.require("TokenFactory");
const Registry = artifacts.require("Registry");
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const AddressWhitelist = artifacts.require("AddressWhitelist");

contract("ExpiringMultiParty", function(accounts) {
  let contractCreator = accounts[0];

  // Contract variables
  let collateralToken;
  let expiringMultiPartyCreator;
  let registry;
  let collateralTokenWhitelist;

  // Re-used variables
  let constructorParams;

  beforeEach(async () => {
    collateralToken = await Token.new({ from: contractCreator });
    registry = await Registry.deployed();
    expiringMultiPartyCreator = await ExpiringMultiPartyCreator.deployed();
    await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, expiringMultiPartyCreator.address, {
      from: contractCreator
    });

    // Whitelist collateral currency
    collateralTokenWhitelist = await AddressWhitelist.at(await expiringMultiPartyCreator.collateralTokenWhitelist());
    await collateralTokenWhitelist.addToWhitelist(collateralToken.address, { from: contractCreator });

    constructorParams = {
      expirationTimestamp: "1234567890",
      collateralAddress: collateralToken.address,
      tokenFactoryAddress: TokenFactory.address,
      priceFeedIdentifier: web3.utils.utf8ToHex("UMATEST"),
      syntheticName: "Test UMA Token",
      syntheticSymbol: "UMATEST",
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

  it("Cannot set expiration timestamp above limit set by EMP creator", async function() {
    // Change only expiration timestamp.
    const latestExpirationAllowed = await expiringMultiPartyCreator.LATEST_EXPIRATION_TIMESTAMP();
    constructorParams.expirationTimestamp = latestExpirationAllowed.add(toBN("1")).toString();
    assert(
      await didContractThrow(
        expiringMultiPartyCreator.createExpiringMultiParty(constructorParams, {
          from: contractCreator
        })
      )
    );
  });

  it("Cannot set dispute bond percentage below limit set by EMP creator", async function() {
    // Change only dispute bond %.
    constructorParams.disputeBondPct = { rawValue: toWei("0") };
    assert(
      await didContractThrow(
        expiringMultiPartyCreator.createExpiringMultiParty(constructorParams, {
          from: contractCreator
        })
      )
    );
  });

  it("Cannot have empty synthetic token symbol", async function() {
    // Change only synthetic token symbol.
    constructorParams.syntheticSymbol = "";
    assert(
      await didContractThrow(
        expiringMultiPartyCreator.createExpiringMultiParty(constructorParams, {
          from: contractCreator
        })
      )
    );
  });

  it("Cannot have empty synthetic token name", async function() {
    // Change only synthetic token name.
    constructorParams.syntheticName = "";
    assert(
      await didContractThrow(
        expiringMultiPartyCreator.createExpiringMultiParty(constructorParams, {
          from: contractCreator
        })
      )
    );
  });

  it("Collateral token must be whitelisted", async function() {
    // Change only the collateral token address
    constructorParams.collateralAddress = await Token.new({ from: contractCreator }).address;
    assert(
      await didContractThrow(
        expiringMultiPartyCreator.createExpiringMultiParty(constructorParams, {
          from: contractCreator
        })
      )
    );
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

    // Ensure value returned from the event is the same as returned from the function.
    assert.equal(functionReturnedAddress, expiringMultiPartyAddress);

    // Instantiate an instance of the expiringMultiParty and check a few constants that should hold true.
    let expiringMultiParty = await ExpiringMultiParty.at(expiringMultiPartyAddress);

    assert.equal(await expiringMultiParty.expirationTimestamp(), constructorParams.expirationTimestamp);
    // Liquidation liveness should be strictly set by EMP creator.
    const enforcedLiquidationLiveness = await expiringMultiPartyCreator.STRICT_LIQUIDATION_LIVENESS();
    assert.equal(await expiringMultiParty.liquidationLiveness(), enforcedLiquidationLiveness.toString());
    // Withdrawal liveness should be strictly set by EMP creator.
    const enforcedWithdrawalLiveness = await expiringMultiPartyCreator.STRICT_WITHDRAWAL_LIVENESS();
    assert.equal(await expiringMultiParty.withdrawalLiveness(), enforcedWithdrawalLiveness.toString());
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
