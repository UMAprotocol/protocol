const { toWei, hexToUtf8 } = web3.utils;
const { didContractThrow, MAX_UINT_VAL, ZERO_ADDRESS } = require("@uma/common");
const truffleAssert = require("truffle-assertions");

// Tested Contract
const PerpetualCreator = artifacts.require("PerpetualCreator");

// Helper Contracts
const Token = artifacts.require("ExpandedERC20");
const SyntheticToken = artifacts.require("SyntheticToken");
const TokenFactory = artifacts.require("TokenFactory");
const Registry = artifacts.require("Registry");
const Perpetual = artifacts.require("Perpetual");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const AddressWhitelist = artifacts.require("AddressWhitelist");
const Store = artifacts.require("Store");

contract("PerpetualCreator", function(accounts) {
  let contractCreator = accounts[0];

  // Contract variables
  let collateralToken;
  let perpetualCreator;
  let registry;
  let collateralTokenWhitelist;
  let store;

  // Re-used variables
  let constructorParams;

  beforeEach(async () => {
    collateralToken = await Token.new("UMA", "UMA", 18, { from: contractCreator });
    registry = await Registry.deployed();
    perpetualCreator = await PerpetualCreator.deployed();

    // Whitelist collateral currency
    collateralTokenWhitelist = await AddressWhitelist.deployed();
    await collateralTokenWhitelist.addToWhitelist(collateralToken.address, { from: contractCreator });

    store = await Store.deployed();

    constructorParams = {
      collateralAddress: collateralToken.address,
      priceFeedIdentifier: web3.utils.utf8ToHex("UMATEST"),
      fundingRateIdentifier: web3.utils.utf8ToHex("UMATEST-FUNDING"),
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

    const identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(constructorParams.priceFeedIdentifier, {
      from: contractCreator
    });
  });

  it("TokenFactory address should be set on construction", async function() {
    const tokenFactory = await TokenFactory.deployed();
    assert.equal(await perpetualCreator.tokenFactoryAddress(), tokenFactory.address);
  });

  it("Cannot have empty synthetic token symbol", async function() {
    // Change only synthetic token symbol.
    constructorParams.syntheticSymbol = "";
    assert(
      await didContractThrow(
        perpetualCreator.createPerpetual(constructorParams, {
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
        perpetualCreator.createPerpetual(constructorParams, {
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
        perpetualCreator.createPerpetual(constructorParams, {
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
        perpetualCreator.createPerpetual(constructorParams, {
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
        perpetualCreator.createPerpetual(constructorParams, {
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
        perpetualCreator.createPerpetual(constructorParams, {
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
        perpetualCreator.createPerpetual(constructorParams, {
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
        perpetualCreator.createPerpetual(constructorParams, {
          from: contractCreator
        })
      )
    );
  });

  it("Can create new instances of Perpetual", async function() {
    // Use `.call` to get the returned value from the function.
    let functionReturnedAddress = await perpetualCreator.createPerpetual.call(constructorParams, {
      from: contractCreator
    });

    // Execute without the `.call` to perform state change. catch the result to query the event.
    let createdAddressResult = await perpetualCreator.createPerpetual(constructorParams, {
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
    let perpetual = await Perpetual.at(perpetualAddress);

    // Liquidation liveness should be the same value as set in the constructor params.
    assert.equal(await perpetual.liquidationLiveness(), constructorParams.liquidationLiveness.toString());
    // Withdrawal liveness should be the same value as set in the constructor params.
    assert.equal(await perpetual.withdrawalLiveness(), constructorParams.withdrawalLiveness.toString());
    assert.equal(hexToUtf8(await perpetual.priceIdentifier()), hexToUtf8(constructorParams.priceFeedIdentifier));
    assert.equal(
      hexToUtf8(await perpetual.fundingRateIdentifier()),
      hexToUtf8(constructorParams.fundingRateIdentifier)
    );

    // Cumulative multipliers are set to default.
    assert.equal((await perpetual.cumulativeFeeMultiplier()).toString(), toWei("1"));
    assert.equal((await perpetual.cumulativeFundingRateMultiplier()).toString(), toWei("1"));

    // Deployed Perpetual timer should be same as Perpetual creator.
    assert.equal(await perpetual.timerAddress(), await perpetualCreator.timerAddress());
  });

  it("Constructs new synthetic currency properly", async function() {
    // Create new derivative contract.
    let createdAddressResult = await perpetualCreator.createPerpetual(constructorParams, {
      from: contractCreator
    });
    let perpetualAddress;
    truffleAssert.eventEmitted(createdAddressResult, "CreatedPerpetual", ev => {
      perpetualAddress = ev.perpetualAddress;
      return ev.perpetualAddress != 0 && ev.deployerAddress == contractCreator;
    });
    let perpetual = await Perpetual.at(perpetualAddress);

    // New synthetic currency and collateral currency should have the same precision.
    const tokenCurrency = await Token.at(await perpetual.tokenCurrency());
    const collateralCurrency = await Token.at(await perpetual.collateralCurrency());
    assert.equal((await tokenCurrency.decimals()).toString(), (await collateralCurrency.decimals()).toString());

    // New derivative contract holds correct permissions.
    const tokenContract = await SyntheticToken.at(tokenCurrency.address);
    assert.isTrue(await tokenContract.isMinter(perpetualAddress));
    assert.isTrue(await tokenContract.isBurner(perpetualAddress));
    assert.isTrue(await tokenContract.holdsRole(0, perpetualAddress));
    assert.isFalse(await tokenContract.isMinter(perpetualCreator.address));
    assert.isFalse(await tokenContract.isBurner(perpetualCreator.address));
  });

  it("Creation correctly registers Perpetual within the registry", async function() {
    let createdAddressResult = await perpetualCreator.createPerpetual(constructorParams, {
      from: contractCreator
    });

    let perpetualAddress;
    truffleAssert.eventEmitted(createdAddressResult, "CreatedPerpetual", ev => {
      perpetualAddress = ev.perpetualAddress;
      return ev.perpetualAddress != 0 && ev.deployerAddress == contractCreator;
    });
    assert.isTrue(await registry.isContractRegistered(perpetualAddress));
  });
});
