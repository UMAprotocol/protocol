// Note: This is placed within the /truffle folder because EmpCreator/PerpCreator.new() fails due to incorrect library linking by hardhat.
// `Error: ExpiringMultiPartyCreator contains unresolved libraries. You must deploy and link the following libraries before
//         you can deploy a new version of ExpiringMultiPartyCreator: $585a446ef18259666e65e81865270bd4dc$`
// We should look more into library linking via hardhat within a script: https://hardhat.org/plugins/hardhat-deploy.html#handling-contract-using-libraries

const winston = require("winston");
const sinon = require("sinon");

const { toWei, utf8ToHex } = web3.utils;

const { FundingRateProposer } = require("../../src/fundingRateProposer");
const {
  FinancialContractFactoryEventClient,
  GasEstimator,
  SpyTransport,
  lastSpyLogLevel,
  spyLogIncludes
} = require("@uma/financial-templates-lib");
const { interfaceName, RegistryRolesEnum } = require("@uma/common");
const { getTruffleContract } = require("@uma/core");

const OptimisticOracle = getTruffleContract("OptimisticOracle", web3);
const PerpetualCreator = getTruffleContract("PerpetualCreator", web3);
const TokenFactory = getTruffleContract("TokenFactory", web3);
const Finder = getTruffleContract("Finder", web3);
const Store = getTruffleContract("Store", web3);
const IdentifierWhitelist = getTruffleContract("IdentifierWhitelist", web3);
const Token = getTruffleContract("ExpandedERC20", web3);
const AddressWhitelist = getTruffleContract("AddressWhitelist", web3);
const Timer = getTruffleContract("Timer", web3);
const Registry = getTruffleContract("Registry", web3);

contract("Perpetual: proposer.js", function(accounts) {
  const deployer = accounts[0];
  const botRunner = accounts[5];

  // Contracts
  let optimisticOracle;
  let perpFactory;
  let finder;
  let store;
  let timer;
  let identifierWhitelist;
  let collateralWhitelist;
  let tokenFactory;
  let registry;
  let collateral;
  let perpsCreated = [];

  // Offchain infra
  let factoryClient;
  let gasEstimator;
  let proposer;
  let spyLogger;
  let spy;

  // Because these identifier utf8 strings begin with "TEST", they will map to PriceFeedMock's,
  // which we can conveniently use to test how the bot queries funding rates.
  const fundingRateIdentifiersToTest = [
    utf8ToHex("TEST18DECIMALS"),
    utf8ToHex("TEST18DECIMALS_2"),
    utf8ToHex("TEST18DECIMALS_3"),
    utf8ToHex("TEST18DECIMALS_4")
  ];

  // Default testing values.
  let defaultCreationParams = {
    expirationTimestamp: "1950000000", // Fri Oct 17 2031 10:40:00 GMT+0000
    priceFeedIdentifier: utf8ToHex("Test Identifier"),
    syntheticName: "Test Synth",
    syntheticSymbol: "TEST-SYNTH",
    collateralRequirement: { rawValue: toWei("1.2") },
    disputeBondPercentage: { rawValue: toWei("0.1") },
    sponsorDisputeRewardPercentage: { rawValue: toWei("0.05") },
    disputerDisputeRewardPercentage: { rawValue: toWei("0.04") },
    minSponsorTokens: { rawValue: toWei("10") },
    withdrawalLiveness: "7200",
    liquidationLiveness: "7300",
    tokenScaling: { rawValue: toWei("1") }
  };
  let configStoreParams = {
    timelockLiveness: 86400, // 1 day
    rewardRatePerSecond: { rawValue: toWei("0.000001") },
    proposerBondPercentage: { rawValue: toWei("0.0001") },
    maxFundingRate: { rawValue: toWei("0.00001") },
    minFundingRate: { rawValue: toWei("-0.00001") },
    proposalTimePastLimit: 1800
  };
  const initialProposerBalance = toWei("100");
  const finalFee = toWei("1");
  const optimisticOracleProposalLiveness = 10;

  before(async function() {
    finder = await Finder.new();
    timer = await Timer.new();
    tokenFactory = await TokenFactory.new();
    perpFactory = await PerpetualCreator.new(finder.address, tokenFactory.address, timer.address);

    // Whitelist an initial identifier so we can deploy.
    identifierWhitelist = await IdentifierWhitelist.new();
    await identifierWhitelist.addSupportedIdentifier(defaultCreationParams.priceFeedIdentifier);
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.IdentifierWhitelist), identifierWhitelist.address);

    store = await Store.new({ rawValue: "0" }, { rawValue: "0" }, timer.address);
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.Store), store.address);

    // Add Registry to finder so factories can register contracts.
    registry = await Registry.new();
    await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, perpFactory.address);
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.Registry), registry.address);

    collateralWhitelist = await AddressWhitelist.new();
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.CollateralWhitelist), collateralWhitelist.address);
  });
  beforeEach(async function() {
    // Set up OO
    optimisticOracle = await OptimisticOracle.new(optimisticOracleProposalLiveness, finder.address, timer.address);
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.OptimisticOracle), optimisticOracle.address);

    // Use the same collateral for all perps.
    collateral = await Token.new("Wrapped Ether", "WETH", "18");
    await collateral.addMember(1, deployer);
    await collateral.mint(deployer, initialProposerBalance);
    await collateral.mint(botRunner, initialProposerBalance);
    await collateralWhitelist.addToWhitelist(collateral.address);
    await store.setFinalFee(collateral.address, { rawValue: finalFee });
    let customCreationParams = {
      ...defaultCreationParams,
      collateralAddress: collateral.address
    };

    // Use a different funding rate identifier for each perpetual.
    for (let i = 0; i < fundingRateIdentifiersToTest.length; i++) {
      // Whitelist funding rate identifier
      await identifierWhitelist.addSupportedIdentifier(fundingRateIdentifiersToTest[i]);
      customCreationParams = {
        ...customCreationParams,
        fundingRateIdentifier: fundingRateIdentifiersToTest[i]
      };

      // Deploy new Perp
      const perpAddress = await perpFactory.createPerpetual.call(customCreationParams, configStoreParams, {
        from: deployer
      });
      const perpCreation = await perpFactory.createPerpetual(customCreationParams, configStoreParams, {
        from: deployer
      });
      perpsCreated.push({ transaction: perpCreation, address: perpAddress });

      spy = sinon.spy();
      spyLogger = winston.createLogger({
        level: "info",
        transports: [new SpyTransport({ level: "info" }, { spy: spy })]
      });

      factoryClient = new FinancialContractFactoryEventClient(
        spyLogger,
        PerpetualCreator.abi,
        web3,
        perpFactory.address,
        0, // startingBlockNumber
        null, // endingBlockNumber
        "Perpetual"
      );

      gasEstimator = new GasEstimator(spyLogger);
    }
  });
  describe("Valid price identifiers", function() {
    let commonPriceFeedConfig;

    beforeEach(async function() {
      // Construct FundingRateProposer using a valid default price feed config containing any additional properties
      // not set in DefaultPriceFeedConfig
      commonPriceFeedConfig = {
        currentPrice: "1.2", // Mocked current price. This will be scaled to the identifier's precision.
        historicalPrice: "2.4" // Mocked historical price. This will be scaled to the identifier's precision.
      };
      // For this test, we'll dispute any proposals that are not equal to historical price up to a
      // 10% margin of error
      let optimisticOracleProposerConfig = {
        fundingRateErrorPercent: 0.1
      };
      proposer = new FundingRateProposer({
        logger: spyLogger,
        perpetualFactoryClient: factoryClient,
        gasEstimator: gasEstimator,
        account: botRunner,
        commonPriceFeedConfig,
        optimisticOracleProposerConfig
      });

      // Update the bot to read the new Perpetual state.
      await proposer.update();
    });

    it("_setAllowances", async function() {
      // Calling it once should set allowances
      await proposer._setAllowances();

      // Check for the successful INFO log emitted by the proposer.
      assert.equal(lastSpyLogLevel(spy), "info");
      assert.isTrue(spyLogIncludes(spy, -1, "Approved Perpetual contract to transfer unlimited collateral tokens"));
      const totalCalls = spy.callCount;

      // Should have sent one INFO log for each perpetual contract that needs allowance to withdraw
      // the proposer's bond.
      assert.equal(spy.callCount, fundingRateIdentifiersToTest.length);

      // Calling it again should skip setting allowances.
      await proposer._setAllowances();
      assert.equal(totalCalls, spy.callCount);
    });
    it("Correctly caches created price feeds", async function() {
      // Call `updateFundingRates` which should create a new pricefeed for each funding rate identifier.
      await proposer.updateFundingRates();

      // Check that only 1 price feed is cached for each unique identifier.
      assert.equal(Object.keys(proposer.priceFeedCache).length, fundingRateIdentifiersToTest.length);

      // Calling `updateFundingRates` again does not modify the cache.
      await proposer.updateFundingRates();
      assert.equal(Object.keys(proposer.priceFeedCache).length, fundingRateIdentifiersToTest.length);
    });

    // TODO:
    // it("Can detect each contract's current funding rate and propose to update it if it has changed beyond some margin", async function() {
    //   // Initial perpetual funding rate is 0, bot should see a different current funding rate and propose.
    // });
  });
});
