const { toWei, hexToUtf8 } = web3.utils;
const { didContractThrow, MAX_UINT_VAL, ZERO_ADDRESS } = require("@uma/common");
const truffleAssert = require("truffle-assertions");

// Tested Contract
const PerpetualPoolPartyCreator = artifacts.require("PerpetualPoolPartyCreator");

// Helper Contracts
const Token = artifacts.require("JarvisExpandedERC20");
const JarvisSyntheticToken = artifacts.require("JarvisSyntheticToken");
const JarvisTokenFactory = artifacts.require("JarvisTokenFactory");
const Registry = artifacts.require("Registry");
const PerpetualPoolParty = artifacts.require("PerpetualPoolParty");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const AddressWhitelist = artifacts.require("AddressWhitelist");
const Store = artifacts.require("Store");

contract("PerpetualCreator", function(accounts) {
  let contractCreator = accounts[0];

  // Contract variables
  let collateralToken;
  let perpetualPoolPartyCreator;
  let registry;
  let collateralTokenWhitelist;
  let store;

  // Re-used variables
  let constructorParams;

  beforeEach(async () => {
    collateralToken = await Token.new("UMA", "UMA", 18, { from: contractCreator });
    registry = await Registry.deployed();
    perpetualPoolPartyCreator = await PerpetualPoolPartyCreator.deployed();

    // Whitelist collateral currency
    collateralTokenWhitelist = await AddressWhitelist.deployed();
    await collateralTokenWhitelist.addToWhitelist(collateralToken.address, { from: contractCreator });

    store = await Store.deployed();

    constructorParams = {
      collateralAddress: collateralToken.address,
      priceFeedIdentifier: web3.utils.utf8ToHex("UMATEST"),
      syntheticName: "Test UMA Token",
      syntheticSymbol: "UMATEST",
      syntheticToken: ZERO_ADDRESS,
      collateralRequirement: { rawValue: toWei("1.5") },
      disputeBondPct: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPct: { rawValue: toWei("0.1") },
      disputerDisputeRewardPct: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") },
      liquidationLiveness: 7200,
      withdrawalLiveness: 7200,
      excessTokenBeneficiary: store.address,
      admins: [accounts[1]],
      pools: [accounts[1]]
    };

    const identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(constructorParams.priceFeedIdentifier, {
      from: contractCreator
    });
  });

  it("JarvisTokenFactory address should be set on construction", async function() {
    const jarvisTokenFactory = await JarvisTokenFactory.deployed();
    assert.equal(await perpetualPoolPartyCreator.tokenFactoryAddress(), jarvisTokenFactory.address);
  });

  it("Cannot have empty synthetic token symbol", async function() {
    // Change only synthetic token symbol.
    constructorParams.syntheticSymbol = "";
    assert(
      await didContractThrow(
        perpetualPoolPartyCreator.createPerpetual(constructorParams, {
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
        perpetualPoolPartyCreator.createPerpetual(constructorParams, {
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
        perpetualPoolPartyCreator.createPerpetual(constructorParams, {
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
        perpetualPoolPartyCreator.createPerpetual(constructorParams, {
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
        perpetualPoolPartyCreator.createPerpetual(constructorParams, {
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
        perpetualPoolPartyCreator.createPerpetual(constructorParams, {
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
        perpetualPoolPartyCreator.createPerpetual(constructorParams, {
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
        perpetualPoolPartyCreator.createPerpetual(constructorParams, {
          from: contractCreator
        })
      )
    );
  });

  it("Admin role can not be void", async function() {
    // Change only the admin role.
    constructorParams.admins = [];
    assert(
      await didContractThrow(
        perpetualPoolPartyCreator.createPerpetual(constructorParams, {
          from: contractCreator
        })
      )
    );
  });

  it("Can create new instances of PerpetualPoolParty", async function() {
    // Use `.call` to get the returned value from the function.
    let functionReturnedAddress = await perpetualPoolPartyCreator.createPerpetual.call(constructorParams, {
      from: contractCreator
    });

    // Execute without the `.call` to perform state change. catch the result to query the event.
    let createdAddressResult = await perpetualPoolPartyCreator.createPerpetual(constructorParams, {
      from: contractCreator
    });

    // Catch the address of the new contract from the event. Ensure that the assigned party member is correct.
    let perpetualAddress;
    truffleAssert.eventEmitted(createdAddressResult, "CreatedPerpetual", ev => {
      perpetualAddress = ev.perpetualAddress;
      return ev.perpetualAddress != 0 && ev.deployerAddress == contractCreator;
    });

    // Ensure value returned from the event is the same as returned from the function.
    assert.equal(functionReturnedAddress, perpetualAddress);

    // Instantiate an instance of the perpetual and check a few constants that should hold true.
    let perpetualPoolParty = await PerpetualPoolParty.at(perpetualAddress);

    // Liquidation liveness should be the same value as set in the constructor params.
    assert.equal(
      (await perpetualPoolParty.liquidatableData.call()).liquidationLiveness,
      constructorParams.liquidationLiveness.toString()
    );
    // Withdrawal liveness should be the same value as set in the constructor params.
    assert.equal(
      (await perpetualPoolParty.positionManagerData.call()).withdrawalLiveness,
      constructorParams.withdrawalLiveness.toString()
    );
    assert.equal(
      hexToUtf8((await perpetualPoolParty.positionManagerData.call()).priceIdentifier),
      hexToUtf8(constructorParams.priceFeedIdentifier)
    );
    // Roles should be the same value as set in the constructor params.
    assert.equal((await perpetualPoolParty.getAdminMembers.call())[0], constructorParams.admins[0]);
    assert.equal((await perpetualPoolParty.getPoolMembers.call())[0], constructorParams.pools[0]);
    // Cumulative multipliers are set to default.
    assert.equal((await perpetualPoolParty.feePayerData.call()).cumulativeFeeMultiplier.toString(), toWei("1"));

    // Deployed Perpetual timer should be same as Perpetual creator.
    assert.equal(await perpetualPoolParty.timerAddress.call(), await perpetualPoolPartyCreator.timerAddress.call());
  });

  it("Constructs new JarvisSynthetic currency properly", async function() {
    collateralToken = await Token.new("UMA", "UMA", 18, { from: contractCreator });
    constructorParams.collateralAddress = collateralToken.address;

    // Whitelist collateral currency
    await collateralTokenWhitelist.addToWhitelist(collateralToken.address, { from: contractCreator });

    // Create new derivative contract.
    let createdAddressResult = await perpetualPoolPartyCreator.createPerpetual(constructorParams, {
      from: contractCreator
    });
    let perpetualAddress;
    truffleAssert.eventEmitted(createdAddressResult, "CreatedPerpetual", ev => {
      perpetualAddress = ev.perpetualAddress;
      return ev.perpetualAddress != 0 && ev.deployerAddress == contractCreator;
    });
    let perpetualPoolParty = await PerpetualPoolParty.at(perpetualAddress);

    // New synthetic currency and collateral currency should have the same precision.
    const tokenCurrency = await Token.at((await perpetualPoolParty.positionManagerData.call()).tokenCurrency);

    // New derivative contract holds correct permissions.
    const tokenContract = await JarvisSyntheticToken.at(tokenCurrency.address);
    assert.isTrue(await tokenContract.isMinter(perpetualAddress));
    assert.isTrue(await tokenContract.isBurner(perpetualAddress));
    assert.equal((await tokenContract.getAdminMembers.call())[0], perpetualAddress);
    assert.equal((await tokenContract.getMinterMembers.call())[0], perpetualPoolParty.address);
    assert.equal((await tokenContract.getBurnerMembers.call())[0], perpetualPoolParty.address);
  });

  it("Creation correctly registers PerpetualPoolParty within the registry", async function() {
    let createdAddressResult = await perpetualPoolPartyCreator.createPerpetual(constructorParams, {
      from: contractCreator
    });
    let perpetualAddress;
    truffleAssert.eventEmitted(createdAddressResult, "CreatedPerpetual", ev => {
      perpetualAddress = ev.perpetualAddress;
      return ev.perpetualAddress != 0 && ev.deployerAddress == contractCreator;
    });
    assert.isTrue(await registry.isContractRegistered.call(perpetualAddress));
  });

  it("If an existing syntethic token is passed as input to the new derivative, it can not have a name different from the input name", async function() {
    const tokenContract = await JarvisSyntheticToken.new("New Test UMA Token", "UMATEST", 18, {
      from: contractCreator
    });
    constructorParams.syntheticToken = tokenContract.address;
    assert(
      await didContractThrow(
        perpetualPoolPartyCreator.createPerpetual(constructorParams, {
          from: contractCreator
        })
      )
    );
  });

  it("If an existing syntethic token is passed as input to the new derivative, it can not have a symbol different from the input symbol", async function() {
    const tokenContract = await JarvisSyntheticToken.new("Test UMA Token", "New UMATEST", 18, {
      from: contractCreator
    });
    constructorParams.syntheticToken = tokenContract.address;
    assert(
      await didContractThrow(
        perpetualPoolPartyCreator.createPerpetual(constructorParams, {
          from: contractCreator
        })
      )
    );
  });

  it("If an existing syntethic token is passed as input, can not have a number of decimals different from 18", async function() {
    const tokenContract = await JarvisSyntheticToken.new("Test UMA Token", "UMATEST", 8, { from: contractCreator });
    constructorParams.syntheticToken = tokenContract.address;
    assert(
      await didContractThrow(
        perpetualPoolPartyCreator.createPerpetual(constructorParams, {
          from: contractCreator
        })
      )
    );
  });

  it("If an existing syntethic token is passed as input, Can create new instances of PerpetualPoolParty", async function() {
    const tokenContract = await JarvisSyntheticToken.new("Test UMA Token", "UMATEST", 18, { from: contractCreator });
    constructorParams.syntheticToken = tokenContract.address;
    let createdAddressResult = await perpetualPoolPartyCreator.createPerpetual(constructorParams, {
      from: contractCreator
    });
    let perpetualAddress;
    truffleAssert.eventEmitted(createdAddressResult, "CreatedPerpetual", ev => {
      perpetualAddress = ev.perpetualAddress;
      return ev.perpetualAddress != 0 && ev.deployerAddress == contractCreator;
    });
    let perpetualPoolParty = await PerpetualPoolParty.at(perpetualAddress);
    assert.equal((await perpetualPoolParty.positionManagerData.call()).tokenCurrency, tokenContract.address);
  });
});
