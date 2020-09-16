const { toWei, hexToUtf8, toBN } = web3.utils;
const { didContractThrow, MAX_UINT_VAL, ZERO_ADDRESS } = require("@uma/common");
const truffleAssert = require("truffle-assertions");

// Tested Contract
const ExpiringMultiPartyCreator = artifacts.require("ExpiringMultiPartyCreator");

// Helper Contracts
const Token = artifacts.require("ExpandedERC20");
const TokenFactory = artifacts.require("TokenFactory");
const Registry = artifacts.require("Registry");
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const AddressWhitelist = artifacts.require("AddressWhitelist");
const Store = artifacts.require("Store");

contract("ExpiringMultiPartyCreator", function(accounts) {
  let contractCreator = accounts[0];

  // Contract variables
  let collateralToken;
  let expiringMultiPartyCreator;
  let registry;
  let collateralTokenWhitelist;
  let store;

  // Re-used variables
  let constructorParams;

  beforeEach(async () => {
    collateralToken = await Token.new("UMA", "UMA", 18, { from: contractCreator });
    registry = await Registry.deployed();
    expiringMultiPartyCreator = await ExpiringMultiPartyCreator.deployed();

    // Whitelist collateral currency
    collateralTokenWhitelist = await AddressWhitelist.deployed();
    await collateralTokenWhitelist.addToWhitelist(collateralToken.address, { from: contractCreator });

    store = await Store.deployed();

    constructorParams = {
      expirationTimestamp: "1898918401", // 2030-03-05T05:20:01.000Z
      collateralAddress: collateralToken.address,
      priceFeedIdentifier: web3.utils.utf8ToHex("UMATEST"),
      syntheticName: "Test UMA Token",
      syntheticSymbol: "UMATEST",
      collateralRequirement: { rawValue: toWei("1.5") },
      disputeBondPct: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPct: { rawValue: toWei("0.1") },
      disputerDisputeRewardPct: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") },
      liquidationLiveness: 7200,
      withdrawalLiveness: 7200,
      excessTokenBeneficiary: store.address
    };

    identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(constructorParams.priceFeedIdentifier, {
      from: contractCreator
    });
  });

  it("TokenFactory address should be set on construction", async function() {
    const tokenFactory = await TokenFactory.deployed();
    assert.equal(await expiringMultiPartyCreator.tokenFactoryAddress(), tokenFactory.address);
  });

  it("Expiration timestamp must be in future", async function() {
    // Change to arbitrary expiration timestamp in the future
    const arbitraryExpiration = "1298918401"; // Monday, February 28, 2011 6:40:01 PM
    // Set to a valid expiry.
    constructorParams.expirationTimestamp = arbitraryExpiration.toString();
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
    constructorParams.collateralAddress = await Token.new("UMA", "UMA", 18, { from: contractCreator }).address;
    assert(
      await didContractThrow(
        expiringMultiPartyCreator.createExpiringMultiParty(constructorParams, {
          from: contractCreator
        })
      )
    );
  });

  it("Withdrawal liveness must not be 0", async function() {
    // Change only the withdrawal liveness
    constructorParams.withdrawalLiveness = 0;
    assert(
      await didContractThrow(
        expiringMultiPartyCreator.createExpiringMultiParty(constructorParams, {
          from: contractCreator
        })
      )
    );
  });

  it("Withdrawal liveness cannot be too large", async function() {
    // Change only the withdrawal liveness
    constructorParams.withdrawalLiveness = MAX_UINT_VAL;
    assert(
      await didContractThrow(
        expiringMultiPartyCreator.createExpiringMultiParty(constructorParams, {
          from: contractCreator
        })
      )
    );
  });

  it("Liquidation liveness must not be 0", async function() {
    // Change only the liquidation liveness
    constructorParams.liquidationLiveness = 0;
    assert(
      await didContractThrow(
        expiringMultiPartyCreator.createExpiringMultiParty(constructorParams, {
          from: contractCreator
        })
      )
    );
  });

  it("Liquidation liveness cannot be too large", async function() {
    // Change only the liquidation liveness
    constructorParams.liquidationLiveness = MAX_UINT_VAL;
    assert(
      await didContractThrow(
        expiringMultiPartyCreator.createExpiringMultiParty(constructorParams, {
          from: contractCreator
        })
      )
    );
  });

  it("Beneficiary cannot be 0x0", async function() {
    // Change only the beneficiary address.
    constructorParams.excessTokenBeneficiary = ZERO_ADDRESS;
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
      return ev.expiringMultiPartyAddress != 0 && ev.deployerAddress == contractCreator;
    });

    // Ensure value returned from the event is the same as returned from the function.
    assert.equal(functionReturnedAddress, expiringMultiPartyAddress);

    // Instantiate an instance of the expiringMultiParty and check a few constants that should hold true.
    let expiringMultiParty = await ExpiringMultiParty.at(expiringMultiPartyAddress);

    assert.equal(await expiringMultiParty.expirationTimestamp(), constructorParams.expirationTimestamp);
    // Liquidation liveness should be the same value as set in the constructor params.
    assert.equal(await expiringMultiParty.liquidationLiveness(), constructorParams.liquidationLiveness.toString());
    // Withdrawal liveness should be the same value as set in the constructor params.
    assert.equal(await expiringMultiParty.withdrawalLiveness(), constructorParams.withdrawalLiveness.toString());
    assert.equal(
      hexToUtf8(await expiringMultiParty.priceIdentifier()),
      hexToUtf8(constructorParams.priceFeedIdentifier)
    );

    // Deployed EMP timer should be same as EMP creator.
    assert.equal(await expiringMultiParty.timerAddress(), await expiringMultiPartyCreator.timerAddress());
  });

  it("Creation correctly registers ExpiringMultiParty within the registry", async function() {
    let createdAddressResult = await expiringMultiPartyCreator.createExpiringMultiParty(constructorParams, {
      from: contractCreator
    });

    let expiringMultiPartyAddress;
    truffleAssert.eventEmitted(createdAddressResult, "CreatedExpiringMultiParty", ev => {
      expiringMultiPartyAddress = ev.expiringMultiPartyAddress;
      return ev.expiringMultiPartyAddress != 0 && ev.deployerAddress == contractCreator;
    });
    assert.isTrue(await registry.isContractRegistered(expiringMultiPartyAddress));
  });
});
