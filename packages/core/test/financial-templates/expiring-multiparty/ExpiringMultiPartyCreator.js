const { toWei, hexToUtf8, padRight, utf8ToHex } = web3.utils;
const { didContractThrow, MAX_UINT_VAL, ZERO_ADDRESS } = require("@uma/common");
const truffleAssert = require("truffle-assertions");

// Tested Contract
const ExpiringMultiPartyCreator = artifacts.require("ExpiringMultiPartyCreator");

// Helper Contracts
const BasicERC20 = artifacts.require("BasicERC20");
const Token = artifacts.require("ExpandedERC20");
const SyntheticToken = artifacts.require("SyntheticToken");
const TokenFactory = artifacts.require("TokenFactory");
const Registry = artifacts.require("Registry");
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const AddressWhitelist = artifacts.require("AddressWhitelist");
const StructuredNoteFinancialProductLibrary = artifacts.require("StructuredNoteFinancialProductLibrary");

contract("ExpiringMultiPartyCreator", function(accounts) {
  let contractCreator = accounts[0];

  // Contract variables
  let collateralToken;
  let expiringMultiPartyCreator;
  let registry;
  let collateralTokenWhitelist;

  // Re-used variables
  let constructorParams;

  beforeEach(async () => {
    collateralToken = await Token.new("Wrapped Ether", "WETH", 18, { from: contractCreator });
    registry = await Registry.deployed();
    expiringMultiPartyCreator = await ExpiringMultiPartyCreator.deployed();

    // Whitelist collateral currency
    collateralTokenWhitelist = await AddressWhitelist.deployed();
    await collateralTokenWhitelist.addToWhitelist(collateralToken.address, { from: contractCreator });

    constructorParams = {
      expirationTimestamp: "1898918401", // 2030-03-05T05:20:01.000Z
      collateralAddress: collateralToken.address,
      priceFeedIdentifier: padRight(utf8ToHex("TEST_IDENTIFIER"), 64),
      syntheticName: "Test Synthetic Token",
      syntheticSymbol: "SYNTH",
      collateralRequirement: { rawValue: toWei("1.5") },
      disputeBondPercentage: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPercentage: { rawValue: toWei("0.1") },
      disputerDisputeRewardPercentage: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") },
      liquidationLiveness: 7200,
      withdrawalLiveness: 7200,
      financialProductLibraryAddress: ZERO_ADDRESS
    };

    const identifierWhitelist = await IdentifierWhitelist.deployed();
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
    constructorParams.collateralAddress = await Token.new("Test Synthetic Token", "SYNTH", 18, {
      from: contractCreator
    }).address;
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

    // Cumulative multipliers are set to default.
    assert.equal((await expiringMultiParty.cumulativeFeeMultiplier()).toString(), toWei("1"));

    // Deployed EMP timer should be same as EMP creator.
    assert.equal(await expiringMultiParty.timerAddress(), await expiringMultiPartyCreator.timerAddress());
  });

  it("Constructs new synthetic currency properly", async function() {
    // Use non-18 decimal precision for collateral currency to test that synthetic matches precision.
    collateralToken = await Token.new("Wrapped Ether", "WETH", 8, { from: contractCreator });
    constructorParams.collateralAddress = collateralToken.address;

    // Whitelist collateral currency
    await collateralTokenWhitelist.addToWhitelist(collateralToken.address, { from: contractCreator });

    // Create new derivative contract.
    let createdAddressResult = await expiringMultiPartyCreator.createExpiringMultiParty(constructorParams, {
      from: contractCreator
    });
    let expiringMultiPartyAddress;
    truffleAssert.eventEmitted(createdAddressResult, "CreatedExpiringMultiParty", ev => {
      expiringMultiPartyAddress = ev.expiringMultiPartyAddress;
      return ev.expiringMultiPartyAddress != 0 && ev.deployerAddress == contractCreator;
    });
    let expiringMultiParty = await ExpiringMultiParty.at(expiringMultiPartyAddress);

    // New synthetic currency and collateral currency should have the same precision.
    const tokenCurrency = await Token.at(await expiringMultiParty.tokenCurrency());
    const collateralCurrency = await Token.at(await expiringMultiParty.collateralCurrency());
    assert.equal((await tokenCurrency.decimals()).toString(), (await collateralCurrency.decimals()).toString());

    // New derivative contract holds correct permissions.
    const tokenContract = await SyntheticToken.at(tokenCurrency.address);
    assert.isTrue(await tokenContract.isMinter(expiringMultiPartyAddress));
    assert.isTrue(await tokenContract.isBurner(expiringMultiPartyAddress));
    assert.isTrue(await tokenContract.holdsRole(0, expiringMultiPartyAddress));
  });

  it("If collateral currency does not implement the decimals() method then synthetic currency defaults to 18 decimals", async function() {
    // Collateral token does not implement decimals() so synthetic token should default to 18.
    collateralToken = await BasicERC20.new(0, { from: contractCreator });
    try {
      await collateralToken.decimals();
    } catch (err) {
      assert.equal(err.message, "collateralToken.decimals is not a function");
    }
    constructorParams.collateralAddress = collateralToken.address;

    // Whitelist collateral currency.
    await collateralTokenWhitelist.addToWhitelist(collateralToken.address, { from: contractCreator });

    // Create new derivative contract.
    let createdAddressResult = await expiringMultiPartyCreator.createExpiringMultiParty(constructorParams, {
      from: contractCreator
    });
    let expiringMultiPartyAddress;
    truffleAssert.eventEmitted(createdAddressResult, "CreatedExpiringMultiParty", ev => {
      expiringMultiPartyAddress = ev.expiringMultiPartyAddress;
      return ev.expiringMultiPartyAddress != 0 && ev.deployerAddress == contractCreator;
    });
    let expiringMultiParty = await ExpiringMultiParty.at(expiringMultiPartyAddress);

    // New synthetic currency should have 18 precision.
    const tokenCurrency = await Token.at(await expiringMultiParty.tokenCurrency());
    assert.equal((await tokenCurrency.decimals()).toString(), "18");
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

  it("Creator can specify a financial product library to transform contract state", async function() {
    // Create a new FPLib that can transform price and configure the factory to link it with a newly deployed EMP.
    const structuredNoteFPL = await StructuredNoteFinancialProductLibrary.new();
    constructorParams.financialProductLibraryAddress = structuredNoteFPL.address;

    // Create the new EMP and grab its saved FPLib.
    let createdAddressResult = await expiringMultiPartyCreator.createExpiringMultiParty(constructorParams, {
      from: contractCreator
    });
    let expiringMultiPartyAddress;
    truffleAssert.eventEmitted(createdAddressResult, "CreatedExpiringMultiParty", ev => {
      expiringMultiPartyAddress = ev.expiringMultiPartyAddress;
      return ev.expiringMultiPartyAddress != 0 && ev.deployerAddress == contractCreator;
    });
    let expiringMultiParty = await ExpiringMultiParty.at(expiringMultiPartyAddress);
    let linkedFPLib = await StructuredNoteFinancialProductLibrary.at(
      await expiringMultiParty.financialProductLibrary()
    );

    // FPLib address is saved correctly.
    assert.equal(linkedFPLib.address, structuredNoteFPL.address);
  });
});
