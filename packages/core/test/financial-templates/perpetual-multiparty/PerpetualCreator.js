const { toWei, hexToUtf8, toBN, padRight, utf8ToHex } = web3.utils;
const { didContractThrow, MAX_UINT_VAL } = require("@uma/common");
const truffleAssert = require("truffle-assertions");

// Tested Contract
const PerpetualCreator = artifacts.require("PerpetualCreator");

// Helper Contracts
const BasicERC20 = artifacts.require("BasicERC20");
const Token = artifacts.require("ExpandedERC20");
const SyntheticToken = artifacts.require("SyntheticToken");
const TokenFactory = artifacts.require("TokenFactory");
const Registry = artifacts.require("Registry");
const Perpetual = artifacts.require("Perpetual");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const AddressWhitelist = artifacts.require("AddressWhitelist");
const ConfigStore = artifacts.require("ConfigStore");

contract("PerpetualCreator", function(accounts) {
  let contractCreator = accounts[0];

  // Contract variables
  let collateralToken;
  let perpetualCreator;
  let registry;
  let collateralTokenWhitelist;
  // Re-used variables
  let constructorParams;

  let testConfig = {
    timelockLiveness: 86400, // 1 day
    rewardRatePerSecond: { rawValue: toWei("0.000001") },
    proposerBondPercentage: { rawValue: toWei("0.0001") },
    maxFundingRate: { rawValue: toWei("0.00001") },
    minFundingRate: { rawValue: toWei("-0.00001") },
    proposalTimePastLimit: 1800
  };

  beforeEach(async () => {
    collateralToken = await Token.new("Wrapped Ether", "WETH", 18, { from: contractCreator });
    registry = await Registry.deployed();
    perpetualCreator = await PerpetualCreator.deployed();

    // Whitelist collateral currency
    collateralTokenWhitelist = await AddressWhitelist.deployed();
    await collateralTokenWhitelist.addToWhitelist(collateralToken.address, { from: contractCreator });

    constructorParams = {
      collateralAddress: collateralToken.address,
      priceFeedIdentifier: padRight(utf8ToHex("TEST_IDENTIFIER"), 64),
      fundingRateIdentifier: padRight(utf8ToHex("TEST_FUNDING_IDENTIFIER"), 64),
      syntheticName: "Test Synthetic Token",
      syntheticSymbol: "SYNTH",
      collateralRequirement: { rawValue: toWei("1.5") },
      disputeBondPercentage: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPercentage: { rawValue: toWei("0.1") },
      disputerDisputeRewardPercentage: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") },
      liquidationLiveness: 7200,
      withdrawalLiveness: 7200,
      tokenScaling: { rawValue: toWei("1") }
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
        perpetualCreator.createPerpetual(constructorParams, testConfig, {
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
        perpetualCreator.createPerpetual(constructorParams, testConfig, {
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
        perpetualCreator.createPerpetual(constructorParams, testConfig, {
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
        perpetualCreator.createPerpetual(constructorParams, testConfig, {
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
        perpetualCreator.createPerpetual(constructorParams, testConfig, {
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
        perpetualCreator.createPerpetual(constructorParams, testConfig, {
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
        perpetualCreator.createPerpetual(constructorParams, testConfig, {
          from: contractCreator
        })
      )
    );
  });

  it("Token scaling cannot be too large", async function() {
    // Change only the token scaling.
    // 1e28 + 1
    constructorParams.tokenScaling = {
      rawValue: toBN(10)
        .pow(toBN(28))
        .addn(1)
        .toString()
    };
    assert(
      await didContractThrow(
        perpetualCreator.createPerpetual(constructorParams, testConfig, {
          from: contractCreator
        })
      )
    );
  });

  it("Token scaling cannot be too small", async function() {
    // Change only the token scaling.
    // 1e8 - 1
    constructorParams.tokenScaling = {
      rawValue: toBN(10)
        .pow(toBN(8))
        .subn(1)
        .toString()
    };
    assert(
      await didContractThrow(
        perpetualCreator.createPerpetual(constructorParams, testConfig, {
          from: contractCreator
        })
      )
    );
  });

  it("Can create new instances of Perpetual", async function() {
    // Use `.call` to get the returned value from the function.
    let functionReturnedAddress = await perpetualCreator.createPerpetual.call(constructorParams, testConfig, {
      from: contractCreator
    });

    // Execute without the `.call` to perform state change. catch the result to query the event.
    let createdAddressResult = await perpetualCreator.createPerpetual(constructorParams, testConfig, {
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
      hexToUtf8((await perpetual.fundingRate()).identifier),
      hexToUtf8(constructorParams.fundingRateIdentifier)
    );

    // Cumulative multipliers are set to default.
    assert.equal((await perpetual.cumulativeFeeMultiplier()).toString(), toWei("1"));
    assert.equal((await perpetual.fundingRate()).cumulativeMultiplier.toString(), toWei("1"));

    // Deployed Perpetual timer should be same as Perpetual creator.
    assert.equal(await perpetual.timerAddress(), await perpetualCreator.timerAddress());
  });

  it("Constructs new synthetic currency properly", async function() {
    // Use non-18 decimal precision for collateral currency to test that synthetic matches precision.
    collateralToken = await Token.new("Wrapped Ether", "WETH", 8, { from: contractCreator });
    constructorParams.collateralAddress = collateralToken.address;

    // Whitelist collateral currency
    await collateralTokenWhitelist.addToWhitelist(collateralToken.address, { from: contractCreator });

    // Create new derivative contract.
    let createdAddressResult = await perpetualCreator.createPerpetual(constructorParams, testConfig, {
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

    // Whitelist collateral currency
    await collateralTokenWhitelist.addToWhitelist(collateralToken.address, { from: contractCreator });

    // Create new derivative contract.
    let createdAddressResult = await perpetualCreator.createPerpetual(constructorParams, testConfig, {
      from: contractCreator
    });
    let perpetualAddress;
    truffleAssert.eventEmitted(createdAddressResult, "CreatedPerpetual", ev => {
      perpetualAddress = ev.perpetualAddress;
      return ev.perpetualAddress != 0 && ev.deployerAddress == contractCreator;
    });
    let perpetual = await Perpetual.at(perpetualAddress);

    // New synthetic currency should have 18 precision.
    const tokenCurrency = await Token.at(await perpetual.tokenCurrency());
    assert.equal((await tokenCurrency.decimals()).toString(), "18");
  });

  it("Creation correctly registers Perpetual within the registry", async function() {
    let createdAddressResult = await perpetualCreator.createPerpetual(constructorParams, testConfig, {
      from: contractCreator
    });

    let perpetualAddress;
    truffleAssert.eventEmitted(createdAddressResult, "CreatedPerpetual", ev => {
      perpetualAddress = ev.perpetualAddress;
      return ev.perpetualAddress != 0 && ev.deployerAddress == contractCreator;
    });
    assert.isTrue(await registry.isContractRegistered(perpetualAddress));
  });

  it("Creation deploys a new ConfigStore and transfers ownership to the deployer", async function() {
    let createdAddressResult = await perpetualCreator.createPerpetual(constructorParams, testConfig, {
      from: contractCreator
    });

    let configStoreAddress;
    truffleAssert.eventEmitted(createdAddressResult, "CreatedConfigStore", ev => {
      configStoreAddress = ev.configStoreAddress;
      return ev.configStoreAddress != 0 && ev.ownerAddress == contractCreator;
    });

    let configStore = await ConfigStore.at(configStoreAddress);
    assert.equal(await configStore.owner(), contractCreator);
  });
  it("Funding rate bounds are set correctly", async function() {
    let createdAddressResult = await perpetualCreator.createPerpetual(constructorParams, testConfig, {
      from: contractCreator
    });

    let perpetualAddress;
    truffleAssert.eventEmitted(createdAddressResult, "CreatedPerpetual", ev => {
      perpetualAddress = ev.perpetualAddress;
      return ev.perpetualAddress != 0 && ev.deployerAddress == contractCreator;
    });
    let perpetual = await Perpetual.at(perpetualAddress);

    const currentTime = (await perpetual.getCurrentTime()).toNumber();
    assert(
      await didContractThrow(
        perpetual.proposeFundingRate({ rawValue: toWei("0.00002") }, currentTime, { from: contractCreator })
      )
    );
  });
});
