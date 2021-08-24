const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract, assertEventEmitted } = hre;
const { toWei, hexToUtf8, padRight, utf8ToHex } = web3.utils;
const { didContractThrow, MAX_UINT_VAL, ZERO_ADDRESS } = require("@uma/common");
const { assert } = require("chai");

// Tested Contract
const ExpiringMultiPartyCreator = getContract("ExpiringMultiPartyCreator");

// Helper Contracts
const BasicERC20 = getContract("BasicERC20");
const Token = getContract("ExpandedERC20");
const SyntheticToken = getContract("SyntheticToken");
const TokenFactory = getContract("TokenFactory");
const Registry = getContract("Registry");
const ExpiringMultiParty = getContract("ExpiringMultiParty");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const AddressWhitelist = getContract("AddressWhitelist");
const StructuredNoteFinancialProductLibrary = getContract("StructuredNoteFinancialProductLibrary");

describe("ExpiringMultiPartyCreator", function () {
  let contractCreator;
  let accounts;

  // Contract variables
  let collateralToken;
  let initialCollateralToken;
  let expiringMultiPartyCreator;
  let registry;
  let collateralTokenWhitelist;

  // Re-used variables
  let constructorParams;

  const identifier = padRight(utf8ToHex("TEST_IDENTIFIER"), 64);

  beforeEach(async () => {
    accounts = await web3.eth.getAccounts();
    [contractCreator] = accounts;
    await runDefaultFixture(hre);
    initialCollateralToken = await Token.new("Wrapped Ether", "WETH", 18).send({ from: contractCreator });
    registry = await Registry.deployed();
    expiringMultiPartyCreator = await ExpiringMultiPartyCreator.deployed();

    // Whitelist collateral currency
    collateralTokenWhitelist = await AddressWhitelist.deployed();
    await collateralTokenWhitelist.methods
      .addToWhitelist(initialCollateralToken.options.address)
      .send({ from: contractCreator });

    const identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.methods.addSupportedIdentifier(identifier).send({ from: contractCreator });
  });

  beforeEach(async () => {
    collateralToken = initialCollateralToken;
    constructorParams = {
      expirationTimestamp: "1898918401", // 2030-03-05T05:20:01.000Z
      collateralAddress: collateralToken.options.address,
      priceFeedIdentifier: identifier,
      syntheticName: "Test Synthetic Token",
      syntheticSymbol: "SYNTH",
      collateralRequirement: { rawValue: toWei("1.5") },
      disputeBondPercentage: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPercentage: { rawValue: toWei("0.1") },
      disputerDisputeRewardPercentage: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") },
      liquidationLiveness: 7200,
      withdrawalLiveness: 7200,
      financialProductLibraryAddress: ZERO_ADDRESS,
    };
  });

  it("TokenFactory address should be set on construction", async function () {
    const tokenFactory = await TokenFactory.deployed();
    assert.equal(await expiringMultiPartyCreator.methods.tokenFactoryAddress().call(), tokenFactory.options.address);
  });

  it("Expiration timestamp must be in future", async function () {
    // Change to arbitrary expiration timestamp in the future
    const arbitraryExpiration = "1298918401"; // Monday, February 28, 2011 6:40:01 PM
    // Set to a valid expiry.
    constructorParams.expirationTimestamp = arbitraryExpiration.toString();
    assert(
      await didContractThrow(
        expiringMultiPartyCreator.methods.createExpiringMultiParty(constructorParams).send({ from: contractCreator })
      )
    );
  });

  it("Cannot have empty synthetic token symbol", async function () {
    // Change only synthetic token symbol.
    constructorParams.syntheticSymbol = "";
    assert(
      await didContractThrow(
        expiringMultiPartyCreator.methods.createExpiringMultiParty(constructorParams).send({ from: contractCreator })
      )
    );
  });

  it("Cannot have empty synthetic token name", async function () {
    // Change only synthetic token name.
    constructorParams.syntheticName = "";
    assert(
      await didContractThrow(
        expiringMultiPartyCreator.methods.createExpiringMultiParty(constructorParams).send({ from: contractCreator })
      )
    );
  });

  it("Collateral token must be whitelisted", async function () {
    // Change only the collateral token address
    constructorParams.collateralAddress = (
      await Token.new("Test Synthetic Token", "SYNTH", 18).send({ from: contractCreator })
    ).options.address;
    assert(
      await didContractThrow(
        expiringMultiPartyCreator.methods.createExpiringMultiParty(constructorParams).send({ from: contractCreator })
      )
    );
  });

  it("Withdrawal liveness must not be 0", async function () {
    // Change only the withdrawal liveness
    constructorParams.withdrawalLiveness = 0;
    assert(
      await didContractThrow(
        expiringMultiPartyCreator.methods.createExpiringMultiParty(constructorParams).send({ from: contractCreator })
      )
    );
  });

  it("Withdrawal liveness cannot be too large", async function () {
    // Change only the withdrawal liveness
    constructorParams.withdrawalLiveness = MAX_UINT_VAL;
    assert(
      await didContractThrow(
        expiringMultiPartyCreator.methods.createExpiringMultiParty(constructorParams).send({ from: contractCreator })
      )
    );
  });

  it("Liquidation liveness must not be 0", async function () {
    // Change only the liquidation liveness
    constructorParams.liquidationLiveness = 0;
    assert(
      await didContractThrow(
        expiringMultiPartyCreator.methods.createExpiringMultiParty(constructorParams).send({ from: contractCreator })
      )
    );
  });

  it("Liquidation liveness cannot be too large", async function () {
    // Change only the liquidation liveness
    constructorParams.liquidationLiveness = MAX_UINT_VAL;
    assert(
      await didContractThrow(
        expiringMultiPartyCreator.methods.createExpiringMultiParty(constructorParams).send({ from: contractCreator })
      )
    );
  });

  it("Can create new instances of ExpiringMultiParty", async function () {
    // Use `.call` to get the returned value from the function.
    let functionReturnedAddress = await expiringMultiPartyCreator.methods
      .createExpiringMultiParty(constructorParams)
      .call({ from: contractCreator });

    // Execute without the `.call` to perform state change. catch the result to query the event.
    let createdAddressResult = await expiringMultiPartyCreator.methods
      .createExpiringMultiParty(constructorParams)
      .send({ from: contractCreator });

    // Catch the address of the new contract from the event. Ensure that the assigned party member is correct.
    let expiringMultiPartyAddress;
    await assertEventEmitted(createdAddressResult, expiringMultiPartyCreator, "CreatedExpiringMultiParty", (ev) => {
      expiringMultiPartyAddress = ev.expiringMultiPartyAddress;
      return ev.expiringMultiPartyAddress != 0 && ev.deployerAddress == contractCreator;
    });

    // Ensure value returned from the event is the same as returned from the function.
    assert.equal(functionReturnedAddress, expiringMultiPartyAddress);

    // Instantiate an instance of the expiringMultiParty and check a few constants that should hold true.
    let expiringMultiParty = await ExpiringMultiParty.at(expiringMultiPartyAddress);

    assert.equal(await expiringMultiParty.methods.expirationTimestamp().call(), constructorParams.expirationTimestamp);
    // Liquidation liveness should be the same value as set in the constructor params.
    assert.equal(
      await expiringMultiParty.methods.liquidationLiveness().call(),
      constructorParams.liquidationLiveness.toString()
    );
    // Withdrawal liveness should be the same value as set in the constructor params.
    assert.equal(
      await expiringMultiParty.methods.withdrawalLiveness().call(),
      constructorParams.withdrawalLiveness.toString()
    );
    assert.equal(
      hexToUtf8(await expiringMultiParty.methods.priceIdentifier().call()),
      hexToUtf8(constructorParams.priceFeedIdentifier)
    );

    // Cumulative multipliers are set to default.
    assert.equal((await expiringMultiParty.methods.cumulativeFeeMultiplier().call()).toString(), toWei("1"));

    // Deployed EMP timer should be same as EMP creator.
    assert.equal(
      await expiringMultiParty.methods.timerAddress().call(),
      await expiringMultiPartyCreator.methods.timerAddress().call()
    );
  });

  it("Constructs new synthetic currency properly", async function () {
    // Use non-18 decimal precision for collateral currency to test that synthetic matches precision.
    collateralToken = await Token.new("Wrapped Ether", "WETH", 8).send({ from: contractCreator });
    constructorParams.collateralAddress = collateralToken.options.address;

    // Whitelist collateral currency
    await collateralTokenWhitelist.methods
      .addToWhitelist(collateralToken.options.address)
      .send({ from: contractCreator });

    // Create new derivative contract.
    let createdAddressResult = await expiringMultiPartyCreator.methods
      .createExpiringMultiParty(constructorParams)
      .send({ from: contractCreator });
    let expiringMultiPartyAddress;
    await assertEventEmitted(createdAddressResult, expiringMultiPartyCreator, "CreatedExpiringMultiParty", (ev) => {
      expiringMultiPartyAddress = ev.expiringMultiPartyAddress;
      return ev.expiringMultiPartyAddress != 0 && ev.deployerAddress == contractCreator;
    });
    let expiringMultiParty = await ExpiringMultiParty.at(expiringMultiPartyAddress);

    // New synthetic currency and collateral currency should have the same precision.
    const tokenCurrency = await Token.at(await expiringMultiParty.methods.tokenCurrency().call());
    const collateralCurrency = await Token.at(await expiringMultiParty.methods.collateralCurrency().call());
    assert.equal(
      (await tokenCurrency.methods.decimals().call()).toString(),
      (await collateralCurrency.methods.decimals().call()).toString()
    );

    // New derivative contract holds correct permissions.
    const tokenContract = await SyntheticToken.at(tokenCurrency.options.address);
    assert.isTrue(await tokenContract.methods.isMinter(expiringMultiPartyAddress).call());
    assert.isTrue(await tokenContract.methods.isBurner(expiringMultiPartyAddress).call());
    assert.isTrue(await tokenContract.methods.holdsRole(0, expiringMultiPartyAddress).call());

    // The creator contract should hold no roles.
    assert.isFalse(await tokenContract.methods.holdsRole(0, expiringMultiPartyCreator.options.address).call());
    assert.isFalse(await tokenContract.methods.holdsRole(1, expiringMultiPartyCreator.options.address).call());
    assert.isFalse(await tokenContract.methods.holdsRole(2, expiringMultiPartyCreator.options.address).call());
  });

  it("If collateral currency does not implement the decimals() method then synthetic currency defaults to 18 decimals", async function () {
    // Collateral token does not implement decimals() so synthetic token should default to 18.
    collateralToken = await BasicERC20.new(0).send({ from: contractCreator });
    try {
      await collateralToken.methods.decimals().send({ from: accounts[0] });
    } catch (err) {
      assert.equal(err.message, "collateralToken.methods.decimals is not a function");
    }
    constructorParams.collateralAddress = collateralToken.options.address;

    // Whitelist collateral currency.
    await collateralTokenWhitelist.methods
      .addToWhitelist(collateralToken.options.address)
      .send({ from: contractCreator });

    // Create new derivative contract.
    let createdAddressResult = await expiringMultiPartyCreator.methods
      .createExpiringMultiParty(constructorParams)
      .send({ from: contractCreator });
    let expiringMultiPartyAddress;
    await assertEventEmitted(createdAddressResult, expiringMultiPartyCreator, "CreatedExpiringMultiParty", (ev) => {
      expiringMultiPartyAddress = ev.expiringMultiPartyAddress;
      return ev.expiringMultiPartyAddress != 0 && ev.deployerAddress == contractCreator;
    });
    let expiringMultiParty = await ExpiringMultiParty.at(expiringMultiPartyAddress);

    // New synthetic currency should have 18 precision.
    const tokenCurrency = await Token.at(await expiringMultiParty.methods.tokenCurrency().call());
    assert.equal((await tokenCurrency.methods.decimals().call()).toString(), "18");
  });

  it("Creation correctly registers ExpiringMultiParty within the registry", async function () {
    let createdAddressResult = await expiringMultiPartyCreator.methods
      .createExpiringMultiParty(constructorParams)
      .send({ from: contractCreator });

    let expiringMultiPartyAddress;
    await assertEventEmitted(createdAddressResult, expiringMultiPartyCreator, "CreatedExpiringMultiParty", (ev) => {
      expiringMultiPartyAddress = ev.expiringMultiPartyAddress;
      return ev.expiringMultiPartyAddress != 0 && ev.deployerAddress == contractCreator;
    });
    assert.isTrue(await registry.methods.isContractRegistered(expiringMultiPartyAddress).call());
  });

  it("Creator can specify a financial product library to transform contract state", async function () {
    // Create a new FPLib that can transform price and configure the factory to link it with a newly deployed EMP.
    const structuredNoteFPL = await StructuredNoteFinancialProductLibrary.new().send({ from: accounts[0] });
    constructorParams.financialProductLibraryAddress = structuredNoteFPL.options.address;

    // Create the new EMP and grab its saved FPLib.
    let createdAddressResult = await expiringMultiPartyCreator.methods
      .createExpiringMultiParty(constructorParams)
      .send({ from: contractCreator });
    let expiringMultiPartyAddress;
    await assertEventEmitted(createdAddressResult, expiringMultiPartyCreator, "CreatedExpiringMultiParty", (ev) => {
      expiringMultiPartyAddress = ev.expiringMultiPartyAddress;
      return ev.expiringMultiPartyAddress != 0 && ev.deployerAddress == contractCreator;
    });
    let expiringMultiParty = await ExpiringMultiParty.at(expiringMultiPartyAddress);
    let linkedFPLib = await StructuredNoteFinancialProductLibrary.at(
      await expiringMultiParty.methods.financialProductLibrary().call()
    );

    // FPLib address is saved correctly.
    assert.equal(linkedFPLib.options.address, structuredNoteFPL.options.address);
  });
});
