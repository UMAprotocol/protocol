const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract, assertEventEmitted } = hre;
const { toWei, hexToUtf8, toBN, padRight, utf8ToHex } = web3.utils;
const { didContractThrow, MAX_UINT_VAL } = require("@uma/common");
const { assert } = require("chai");

// Tested Contract
const PerpetualCreator = getContract("PerpetualCreator");

// Helper Contracts
const BasicERC20 = getContract("BasicERC20");
const Token = getContract("ExpandedERC20");
const SyntheticToken = getContract("SyntheticToken");
const TokenFactory = getContract("TokenFactory");
const Registry = getContract("Registry");
const Perpetual = getContract("Perpetual");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const AddressWhitelist = getContract("AddressWhitelist");
const ConfigStore = getContract("ConfigStore");

describe("PerpetualCreator", function () {
  let accounts;
  let contractCreator;

  // Contract variables
  let collateralToken;
  let perpetualCreator;
  let registry;
  let collateralTokenWhitelist;
  let identifierWhitelist;
  // Re-used variables
  let constructorParams;

  let testConfig = {
    timelockLiveness: 86400, // 1 day
    rewardRatePerSecond: { rawValue: toWei("0.000001") },
    proposerBondPercentage: { rawValue: toWei("0.0001") },
    maxFundingRate: { rawValue: toWei("0.00001") },
    minFundingRate: { rawValue: toWei("-0.00001") },
    proposalTimePastLimit: 1800,
  };

  const priceFeedIdentifier = padRight(utf8ToHex("TEST_IDENTIFIER"), 64);

  before(async () => {
    accounts = await web3.eth.getAccounts();
    [contractCreator] = accounts;
    await runDefaultFixture(hre);
    registry = await Registry.deployed();
    perpetualCreator = await PerpetualCreator.deployed();
    collateralTokenWhitelist = await AddressWhitelist.deployed();
    identifierWhitelist = await IdentifierWhitelist.deployed();

    await identifierWhitelist.methods.addSupportedIdentifier(priceFeedIdentifier).send({ from: contractCreator });
  });

  beforeEach(async () => {
    collateralToken = await Token.new("Wrapped Ether", "WETH", 18).send({ from: contractCreator });

    // Whitelist collateral currency
    await collateralTokenWhitelist.methods
      .addToWhitelist(collateralToken.options.address)
      .send({ from: contractCreator });

    constructorParams = {
      collateralAddress: collateralToken.options.address,
      priceFeedIdentifier: padRight(utf8ToHex("TEST_IDENTIFIER"), 64),
      fundingRateIdentifier: padRight(utf8ToHex("TEST_FUNDING"), 64),
      syntheticName: "Test Synthetic Token",
      syntheticSymbol: "SYNTH",
      collateralRequirement: { rawValue: toWei("1.5") },
      disputeBondPercentage: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPercentage: { rawValue: toWei("0.1") },
      disputerDisputeRewardPercentage: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") },
      liquidationLiveness: 7200,
      withdrawalLiveness: 7200,
      tokenScaling: { rawValue: toWei("1") },
    };
  });

  it("TokenFactory address should be set on construction", async function () {
    const tokenFactory = await TokenFactory.deployed();
    assert.equal(await perpetualCreator.methods.tokenFactoryAddress().call(), tokenFactory.options.address);
  });

  it("Cannot have empty synthetic token symbol", async function () {
    // Change only synthetic token symbol.
    constructorParams.syntheticSymbol = "";
    assert(
      await didContractThrow(
        perpetualCreator.methods.createPerpetual(constructorParams, testConfig).send({ from: contractCreator })
      )
    );
  });

  it("Cannot have empty synthetic token name", async function () {
    // Change only synthetic token name.
    constructorParams.syntheticName = "";
    assert(
      await didContractThrow(
        perpetualCreator.methods.createPerpetual(constructorParams, testConfig).send({ from: contractCreator })
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
        perpetualCreator.methods.createPerpetual(constructorParams, testConfig).send({ from: contractCreator })
      )
    );
  });

  it("Withdrawal liveness must not be 0", async function () {
    // Change only the withdrawal liveness
    constructorParams.withdrawalLiveness = 0;
    assert(
      await didContractThrow(
        perpetualCreator.methods.createPerpetual(constructorParams, testConfig).send({ from: contractCreator })
      )
    );
  });

  it("Withdrawal liveness cannot be too large", async function () {
    // Change only the withdrawal liveness
    constructorParams.withdrawalLiveness = MAX_UINT_VAL;
    assert(
      await didContractThrow(
        perpetualCreator.methods.createPerpetual(constructorParams, testConfig).send({ from: contractCreator })
      )
    );
  });

  it("Liquidation liveness must not be 0", async function () {
    // Change only the liquidation liveness
    constructorParams.liquidationLiveness = 0;
    assert(
      await didContractThrow(
        perpetualCreator.methods.createPerpetual(constructorParams, testConfig).send({ from: contractCreator })
      )
    );
  });

  it("Liquidation liveness cannot be too large", async function () {
    // Change only the liquidation liveness
    constructorParams.liquidationLiveness = MAX_UINT_VAL;
    assert(
      await didContractThrow(
        perpetualCreator.methods.createPerpetual(constructorParams, testConfig).send({ from: contractCreator })
      )
    );
  });

  it("Token scaling cannot be too large", async function () {
    // Change only the token scaling.
    // 1e28 + 1
    constructorParams.tokenScaling = { rawValue: toBN(10).pow(toBN(28)).addn(1).toString() };
    assert(
      await didContractThrow(
        perpetualCreator.methods.createPerpetual(constructorParams, testConfig).send({ from: contractCreator })
      )
    );
  });

  it("Token scaling cannot be too small", async function () {
    // Change only the token scaling.
    // 1e8 - 1
    constructorParams.tokenScaling = { rawValue: toBN(10).pow(toBN(8)).subn(1).toString() };
    assert(
      await didContractThrow(
        perpetualCreator.methods.createPerpetual(constructorParams, testConfig).send({ from: contractCreator })
      )
    );
  });

  it("Can create new instances of Perpetual", async function () {
    // Use `.call` to get the returned value from the function.
    let functionReturnedAddress = await perpetualCreator.methods
      .createPerpetual(constructorParams, testConfig)
      .call({ from: contractCreator });

    // Execute without the `.call` to perform state change. catch the result to query the event.
    let createdAddressResult = await perpetualCreator.methods
      .createPerpetual(constructorParams, testConfig)
      .send({ from: contractCreator });

    // Catch the address of the new contract from the event. Ensure that the assigned party member is correct.
    let perpetualAddress;
    await assertEventEmitted(createdAddressResult, perpetualCreator, "CreatedPerpetual", (ev) => {
      perpetualAddress = ev.perpetualAddress;
      return ev.perpetualAddress != 0 && ev.deployerAddress == contractCreator;
    });

    // Ensure value returned from the event is the same as returned from the function.
    assert.equal(functionReturnedAddress, perpetualAddress);

    // Instantiate an instance of the perpetual and check a few constants that should hold true.
    let perpetual = await Perpetual.at(perpetualAddress);

    // Liquidation liveness should be the same value as set in the constructor params.
    assert.equal(
      await perpetual.methods.liquidationLiveness().call(),
      constructorParams.liquidationLiveness.toString()
    );
    // Withdrawal liveness should be the same value as set in the constructor params.
    assert.equal(await perpetual.methods.withdrawalLiveness().call(), constructorParams.withdrawalLiveness.toString());
    assert.equal(
      hexToUtf8(await perpetual.methods.priceIdentifier().call()),
      hexToUtf8(constructorParams.priceFeedIdentifier)
    );
    assert.equal(
      hexToUtf8((await perpetual.methods.fundingRate().call()).identifier),
      hexToUtf8(constructorParams.fundingRateIdentifier)
    );

    // Cumulative multipliers are set to default.
    assert.equal((await perpetual.methods.cumulativeFeeMultiplier().call()).toString(), toWei("1"));
    assert.equal((await perpetual.methods.fundingRate().call()).cumulativeMultiplier.toString(), toWei("1"));

    // Deployed Perpetual timer should be same as Perpetual creator.
    assert.equal(await perpetual.methods.timerAddress().call(), await perpetualCreator.methods.timerAddress().call());
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
    let createdAddressResult = await perpetualCreator.methods
      .createPerpetual(constructorParams, testConfig)
      .send({ from: contractCreator });
    let perpetualAddress;
    await assertEventEmitted(createdAddressResult, perpetualCreator, "CreatedPerpetual", (ev) => {
      perpetualAddress = ev.perpetualAddress;
      return ev.perpetualAddress != 0 && ev.deployerAddress == contractCreator;
    });
    let perpetual = await Perpetual.at(perpetualAddress);

    // New synthetic currency and collateral currency should have the same precision.
    const tokenCurrency = await Token.at(await perpetual.methods.tokenCurrency().call());
    const collateralCurrency = await Token.at(await perpetual.methods.collateralCurrency().call());
    assert.equal(
      (await tokenCurrency.methods.decimals().call()).toString(),
      (await collateralCurrency.methods.decimals().call()).toString()
    );

    // New derivative contract holds correct permissions.
    const tokenContract = await SyntheticToken.at(tokenCurrency.options.address);
    assert.isTrue(await tokenContract.methods.isMinter(perpetualAddress).call());
    assert.isTrue(await tokenContract.methods.isBurner(perpetualAddress).call());
    assert.isTrue(await tokenContract.methods.holdsRole(0, perpetualAddress).call());

    // The creator contract should hold no roles.
    assert.isFalse(await tokenContract.methods.holdsRole(0, perpetualCreator.options.address).call());
    assert.isFalse(await tokenContract.methods.holdsRole(1, perpetualCreator.options.address).call());
    assert.isFalse(await tokenContract.methods.holdsRole(2, perpetualCreator.options.address).call());
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

    // Whitelist collateral currency
    await collateralTokenWhitelist.methods
      .addToWhitelist(collateralToken.options.address)
      .send({ from: contractCreator });

    // Create new derivative contract.
    let createdAddressResult = await perpetualCreator.methods
      .createPerpetual(constructorParams, testConfig)
      .send({ from: contractCreator });
    let perpetualAddress;
    await assertEventEmitted(createdAddressResult, perpetualCreator, "CreatedPerpetual", (ev) => {
      perpetualAddress = ev.perpetualAddress;
      return ev.perpetualAddress != 0 && ev.deployerAddress == contractCreator;
    });
    let perpetual = await Perpetual.at(perpetualAddress);

    // New synthetic currency should have 18 precision.
    const tokenCurrency = await Token.at(await perpetual.methods.tokenCurrency().call());
    assert.equal((await tokenCurrency.methods.decimals().call()).toString(), "18");
  });

  it("Creation correctly registers Perpetual within the registry", async function () {
    let createdAddressResult = await perpetualCreator.methods
      .createPerpetual(constructorParams, testConfig)
      .send({ from: contractCreator });

    let perpetualAddress;
    await assertEventEmitted(createdAddressResult, perpetualCreator, "CreatedPerpetual", (ev) => {
      perpetualAddress = ev.perpetualAddress;
      return ev.perpetualAddress != 0 && ev.deployerAddress == contractCreator;
    });
    assert.isTrue(await registry.methods.isContractRegistered(perpetualAddress).call());
  });

  it("Creation deploys a new ConfigStore and transfers ownership to the deployer", async function () {
    let createdAddressResult = await perpetualCreator.methods
      .createPerpetual(constructorParams, testConfig)
      .send({ from: contractCreator });

    let configStoreAddress;
    await assertEventEmitted(createdAddressResult, perpetualCreator, "CreatedConfigStore", (ev) => {
      configStoreAddress = ev.configStoreAddress;
      return ev.configStoreAddress != 0 && ev.ownerAddress == contractCreator;
    });

    let configStore = await ConfigStore.at(configStoreAddress);
    assert.equal(await configStore.methods.owner().call(), contractCreator);
  });
  it("Funding rate bounds are set correctly", async function () {
    let createdAddressResult = await perpetualCreator.methods
      .createPerpetual(constructorParams, testConfig)
      .send({ from: contractCreator });

    let perpetualAddress;
    await assertEventEmitted(createdAddressResult, perpetualCreator, "CreatedPerpetual", (ev) => {
      perpetualAddress = ev.perpetualAddress;
      return ev.perpetualAddress != 0 && ev.deployerAddress == contractCreator;
    });
    let perpetual = await Perpetual.at(perpetualAddress);

    const currentTime = parseInt(await perpetual.methods.getCurrentTime().call());
    assert(
      await didContractThrow(
        perpetual.methods
          .proposeFundingRate({ rawValue: toWei("0.00002") }, currentTime)
          .send({ from: contractCreator })
      )
    );
  });
});
