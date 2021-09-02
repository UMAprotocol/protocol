const winston = require("winston");
const sinon = require("sinon");

const { FundingRateProposer } = require("../src/proposer");
const {
  FinancialContractFactoryClient,
  GasEstimator,
  SpyTransport,
  lastSpyLogLevel,
  spyLogIncludes,
  PriceFeedMockScaled,
} = require("@uma/financial-templates-lib");
const { interfaceName, OptimisticOracleRequestStatesEnum, RegistryRolesEnum } = require("@uma/common");
const { deployments, getContract, web3, getChainId } = require("hardhat");
const { getAddress, getAbi } = require("@uma/contracts-node");
const { assert } = require("chai");

const { toWei, utf8ToHex, hexToUtf8, padRight } = web3.utils;

const OptimisticOracle = getContract("OptimisticOracle");
const PerpetualCreator = getContract("PerpetualCreator");
const PerpetualLib = getContract("PerpetualLib");
const Perpetual = getContract("Perpetual");
const Finder = getContract("Finder");
const Store = getContract("Store");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const Token = getContract("ExpandedERC20");
const AddressWhitelist = getContract("AddressWhitelist");
const Timer = getContract("Timer");
const TokenFactory = getContract("TokenFactory");
const Registry = getContract("Registry");
const MulticallMock = getContract("MulticallMock");

describe("Perpetual: proposer.js", function () {
  // Accounts
  let deployer;
  let botRunner;

  // Contracts
  let optimisticOracle;
  let perpFactory;
  let finder;
  let store;
  let timer;
  let identifierWhitelist;
  let collateralWhitelist;
  let collateral;
  let perpsCreated;
  let multicall;

  // Offchain infra
  let factoryClient;
  let gasEstimator;
  let proposer;
  let spyLogger;
  let spy;

  // Because these identifier utf8 strings begin with "TEST", they will map to PriceFeedMock's,
  // which we can conveniently use to test how the bot queries funding rates.
  const fundingRateIdentifiersToTest = [
    padRight(utf8ToHex("TEST18DECIMALS"), 64),
    padRight(utf8ToHex("TEST18DECIMALS_2"), 64),
    padRight(utf8ToHex("TEST18DECIMALS_3"), 64),
    padRight(utf8ToHex("TEST18DECIMALS_4"), 64),
  ];

  // Default testing values.
  let defaultCreationParams = {
    expirationTimestamp: "1950000000", // Fri Oct 17 2031 10:40:00 GMT+0000
    priceFeedIdentifier: padRight(utf8ToHex("Test Identifier"), 64),
    syntheticName: "Test Synth",
    syntheticSymbol: "TEST-SYNTH",
    collateralRequirement: { rawValue: toWei("1.2") },
    disputeBondPercentage: { rawValue: toWei("0.1") },
    sponsorDisputeRewardPercentage: { rawValue: toWei("0.05") },
    disputerDisputeRewardPercentage: { rawValue: toWei("0.04") },
    minSponsorTokens: { rawValue: toWei("10") },
    withdrawalLiveness: "7200",
    liquidationLiveness: "7300",
    tokenScaling: { rawValue: toWei("1") },
  };
  let configStoreParams = {
    timelockLiveness: 86400, // 1 day
    rewardRatePerSecond: { rawValue: toWei("0.000001") },
    proposerBondPercentage: { rawValue: toWei("0.0001") },
    maxFundingRate: { rawValue: toWei("0.00001") },
    minFundingRate: { rawValue: toWei("-0.00001") },
    proposalTimePastLimit: 1800,
  };
  const initialProposerBalance = toWei("100");
  const finalFee = toWei("1");
  const optimisticOracleProposalLiveness = 10;
  let startTime;
  let latestProposalTime;
  let commonPriceFeedConfig;

  const verifyOracleState = async (state, perpetualAddress, identifier, requestTime, ancillaryData) => {
    assert.equal(
      (
        await optimisticOracle.methods
          .getState(perpetualAddress, identifier, requestTime, ancillaryData)
          .call({ from: deployer })
      ).toString(),
      state
    );
  };

  before(async function () {
    [deployer, botRunner] = await web3.eth.getAccounts();
    finder = await Finder.new().send({ from: deployer });
    timer = await Timer.new().send({ from: deployer });
    multicall = await MulticallMock.new().send({ from: deployer });

    // Whitelist an price identifier so we can deploy.
    identifierWhitelist = await IdentifierWhitelist.new().send({ from: deployer });
    await identifierWhitelist.methods
      .addSupportedIdentifier(defaultCreationParams.priceFeedIdentifier)
      .send({ from: deployer });
    // Whitelist funding rate identifiers:
    fundingRateIdentifiersToTest.forEach(async (id) => {
      await identifierWhitelist.methods.addSupportedIdentifier(id).send({ from: deployer });
    });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.IdentifierWhitelist), identifierWhitelist.options.address)
      .send({ from: deployer });

    // Store is neccessary to set up because contracts will need to read final fees before allowing
    // a proposal.
    store = await Store.new({ rawValue: "0" }, { rawValue: "0" }, timer.options.address).send({ from: deployer });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Store), store.options.address)
      .send({ from: deployer });
  });

  beforeEach(async function () {
    const tokenFactory = await TokenFactory.new().send({ from: deployer });

    // Deploy new Perpetual factory such that it is retrievable by the client via getAddress
    // Note: use hre.deployments.deploy method to link libraries.
    const perpetualLib = await PerpetualLib.new().send({ from: deployer });
    await deployments.deploy("PerpetualCreator", {
      from: deployer,
      args: [finder.options.address, tokenFactory.options.address, timer.options.address],
      libraries: { PerpetualLib: perpetualLib.options.address },
    });
    perpFactory = await PerpetualCreator.at(await getAddress("PerpetualCreator", parseInt(await getChainId())));

    // Deploy new registry so perp factory can register contracts.
    const registry = await Registry.new().send({ from: deployer });
    await registry.methods
      .addMember(RegistryRolesEnum.CONTRACT_CREATOR, perpFactory.options.address)
      .send({ from: deployer });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Registry), registry.options.address)
      .send({ from: deployer });

    // Set up new OO with custom settings.
    optimisticOracle = await OptimisticOracle.new(
      optimisticOracleProposalLiveness,
      finder.options.address,
      timer.options.address
    ).send({ from: deployer });
    await registry.methods
      .addMember(RegistryRolesEnum.CONTRACT_CREATOR, optimisticOracle.options.address)
      .send({ from: deployer });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.OptimisticOracle), optimisticOracle.options.address)
      .send({ from: deployer });

    // Whitelist and use same collateral for all perps.
    collateral = await Token.new("Wrapped Ether", "WETH", "18").send({ from: deployer });
    await collateral.methods.addMember(1, deployer).send({ from: deployer });
    await collateral.methods.mint(deployer, initialProposerBalance).send({ from: deployer });
    await collateral.methods.mint(botRunner, initialProposerBalance).send({ from: deployer });
    collateralWhitelist = await AddressWhitelist.new().send({ from: deployer });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.CollateralWhitelist), collateralWhitelist.options.address)
      .send({ from: deployer });
    await collateralWhitelist.methods.addToWhitelist(collateral.options.address).send({ from: deployer });

    // Set non-0 final fee to test that bot can stake proposer bond.
    await store.methods.setFinalFee(collateral.options.address, { rawValue: finalFee }).send({ from: deployer });
    let customCreationParams = { ...defaultCreationParams, collateralAddress: collateral.options.address };

    // Before creating new perps, save the current contract time because this gets initialized as the
    // "last update time" for the perps. This is important to track because new proposals can only
    // come after the last update time.
    startTime = await timer.methods.getCurrentTime().call({ from: deployer });
    // Use a different funding rate identifier for each perpetual.
    perpsCreated = [];
    for (let i = 0; i < fundingRateIdentifiersToTest.length; i++) {
      customCreationParams = { ...customCreationParams, fundingRateIdentifier: fundingRateIdentifiersToTest[i] };

      // Deploy new Perp
      const perpAddress = await perpFactory.methods
        .createPerpetual(customCreationParams, configStoreParams)
        .call({ from: deployer });
      const perpCreation = await perpFactory.methods
        .createPerpetual(customCreationParams, configStoreParams)
        .send({ from: deployer });

      const perpContract = await Perpetual.at(perpAddress);
      const tokenAddress = await perpContract.methods.tokenCurrency().call({ from: deployer });
      const ancillaryData = utf8ToHex(`tokenAddress:${tokenAddress.substr(2).toLowerCase()}`);
      perpsCreated.push({ transaction: perpCreation, address: perpContract.options.address, ancillaryData });
    }

    // Construct helper classes for proposer bot
    spy = sinon.spy();
    spyLogger = winston.createLogger({
      level: "debug",
      transports: [new SpyTransport({ level: "debug" }, { spy: spy })],
    });
    factoryClient = new FinancialContractFactoryClient(
      spyLogger,
      getAbi("PerpetualCreator"),
      web3,
      perpFactory.options.address,
      0, // startingBlockNumber
      null // endingBlockNumber
    );
    gasEstimator = new GasEstimator(spyLogger);

    // Construct FundingRateProposer using a valid default price feed config containing any additional properties
    // not set in DefaultPriceFeedConfig
    latestProposalTime = parseInt(startTime) + 1;
    commonPriceFeedConfig = {
      historicalPrice: "0.000005",
      // Mocked historical price. This will be scaled to the identifier's precision. 1/2 of max funding rate
      currentPrice: "0.000001",
      // Mocked current price. This should be irrelevant for these tests.
      lastUpdateTime: latestProposalTime,
      // On funding rate updates, proposer requests a price for this time. This must be > than the Perpetual
      // contract's last update time, which is the `startTime` when it was deployed. So we start
      // the pricefeed 1 second after the perpetual has begun.
    };
    // Additionally, advance the perpetual contract forward in time to match pricefeed's update time, otherwise
    // the proposal will fail because it is "in the future".
    await timer.methods.setCurrentTime(latestProposalTime).send({ from: deployer });
    // For this test, we'll dispute any proposals that are not equal to historical price up to a
    // 10% margin of error
    let optimisticOracleProposerConfig = { fundingRateErrorPercent: 0.1 };
    proposer = new FundingRateProposer({
      logger: spyLogger,
      perpetualFactoryClient: factoryClient,
      multicallContractAddress: multicall.options.address,
      gasEstimator: gasEstimator,
      account: botRunner,
      commonPriceFeedConfig,
      optimisticOracleProposerConfig,
    });
  });
  describe("(update)", function () {
    beforeEach(async function () {
      // Read new Perpetual state.
      await proposer.update();
    });
    it("(_cachePerpetualContracts)", async function () {
      // `update` should create a new contract instance for each contract
      for (let i = 0; i < fundingRateIdentifiersToTest.length; i++) {
        const cachedContract = proposer.contractCache[perpsCreated[i].address];
        // Check that bot fetches on-chain state from perpetual and config store correctly.
        assert.equal(
          hexToUtf8(cachedContract.state.currentFundingRateData.identifier),
          hexToUtf8(fundingRateIdentifiersToTest[i])
        );
        assert.equal(cachedContract.state.currentFundingRateData.proposalTime, "0");
        assert.equal(
          cachedContract.state.currentConfig.maxFundingRate.toString(),
          configStoreParams.maxFundingRate.rawValue
        );
        assert.equal(
          cachedContract.state.currentConfig.minFundingRate.toString(),
          configStoreParams.minFundingRate.rawValue
        );
      }

      // Calling `_cachePerpetualContracts` usually emits DEBUG logs for
      // each newly cached object. Calling it again should do nothing since we've already
      // cached the contracts.
      const spyCount = spy.callCount;
      await proposer._cachePerpetualContracts();
      assert.equal(spyCount, spy.callCount);
    });
    it("(_setAllowances)", async function () {
      // `update` should set allowances for all contract collateral currencies.

      // Check for the successful INFO log emitted by the proposer.
      assert.equal(lastSpyLogLevel(spy), "info");
      assert.isTrue(spyLogIncludes(spy, -1, "Approved Perpetual contract to transfer unlimited collateral tokens"));
      const spyCount = spy.callCount;

      // Should have sent one INFO log for each perpetual contract that needs allowance to withdraw
      // the proposer's bond.
      let infoLogs = 0;
      for (let i = 0; i < spyCount; i++) {
        if (spy.getCall(-(i + 1)).lastArg.level === "info") {
          infoLogs += 1;
        }
      }
      assert.equal(infoLogs, fundingRateIdentifiersToTest.length);

      // Calling `_setAllowances` again should not emit any logs about setting allowances.
      await proposer._setAllowances();
      assert.equal(spyCount, spy.callCount);
    });
    it("(_createOrGetCachedPriceFeed)", async function () {
      // should create a new pricefeed for each funding rate identifier.
      assert.equal(Object.keys(proposer.priceFeedCache).length, fundingRateIdentifiersToTest.length);
      for (let i = 0; i < fundingRateIdentifiersToTest.length; i++) {
        assert.isTrue(
          proposer.priceFeedCache[hexToUtf8(fundingRateIdentifiersToTest[i])] instanceof PriceFeedMockScaled
        );
      }
      // Calling `_createOrGetCachedPriceFeed` usually emits DEBUG logs for
      // each newly cached object. Calling it again should do nothing since we've already
      // cached the price feeds.
      const spyCount = spy.callCount;
      await proposer._createOrGetCachedPriceFeed();
      assert.equal(spyCount, spy.callCount);
    });
    describe("(updateFundingRate)", function () {
      beforeEach(async function () {
        // Initial perpetual funding rate for all identifiers is 0,
        // bot should see a different current funding rate from the PriceFeedMockScaled and propose.
        await proposer.updateFundingRates(true);
      });
      it("Detects each contract's current (or publishable) funding rate and proposes to update it if it has changed beyond some margin", async function () {
        // Check that the identifiers all have been proposed to.
        for (let i = 0; i < fundingRateIdentifiersToTest.length; i++) {
          await verifyOracleState(
            OptimisticOracleRequestStatesEnum.PROPOSED,
            perpsCreated[i].address,
            fundingRateIdentifiersToTest[i],
            latestProposalTime,
            perpsCreated[i].ancillaryData
          );
        }

        // Check for the successful INFO log emitted by the proposer.
        assert.equal(lastSpyLogLevel(spy), "info");
        assert.isTrue(spyLogIncludes(spy, -1, "Proposed new funding rate"));
        // Proposal bond for each perp should be equal to final fee + PfC * proposal bond pct. PfC should be 0.
        assert.equal(spy.getCall(-1).lastArg.proposalBond, finalFee);
        assert.ok(spy.getCall(-1).lastArg.proposalResult.tx);

        // Running `updateFundingRates()` on updated contract state does nothing because all
        // identifiers have pending (undisputed), unexpired proposals.
        await proposer.update();
        await proposer.updateFundingRates(true);
        assert.isTrue(spyLogIncludes(spy, -1, "Proposal is already pending"));

        // Once the proposal has expired, the proposer should be able to propose another funding rate if the price feed
        // rate has meaningful diverged from the newly published rate:
        const originalProposalTime = latestProposalTime;
        latestProposalTime += optimisticOracleProposalLiveness;
        await timer.methods.setCurrentTime(latestProposalTime).send({ from: deployer });
        // All proposals should be expired, but not settled:
        for (let i = 0; i < fundingRateIdentifiersToTest.length; i++) {
          await verifyOracleState(
            OptimisticOracleRequestStatesEnum.EXPIRED,
            perpsCreated[i].address,
            fundingRateIdentifiersToTest[i],
            originalProposalTime,
            perpsCreated[i].ancillaryData
          );
        }
        await proposer.update();
        await proposer.updateFundingRates(true);
        assert.equal(lastSpyLogLevel(spy), "debug");
        assert.isTrue(
          spyLogIncludes(spy, -1, "Skipping proposal because current rate is within allowed margin of error")
        );
        // Since pricefeed hasn't changed, the publishable "currentRate" should be equal to the "proposedRate":
        assert.equal(spy.getCall(-1).lastArg.proposedRate, spy.getCall(-1).lastArg.currentRate);

        // The pricefeed has now diverged enough from the publishable rate that we can propose again:
        let pricesToPropose = "0.000006";
        for (let i = 0; i < fundingRateIdentifiersToTest.length; i++) {
          const priceFeed = proposer.priceFeedCache[hexToUtf8(fundingRateIdentifiersToTest[i])];
          priceFeed.setHistoricalPrice(pricesToPropose);
          priceFeed.setLastUpdateTime(latestProposalTime);
        }
        await proposer.updateFundingRates(true);
        for (let i = 0; i < fundingRateIdentifiersToTest.length; i++) {
          // The first proposals should be settled now:
          await verifyOracleState(
            OptimisticOracleRequestStatesEnum.SETTLED,
            perpsCreated[i].address,
            fundingRateIdentifiersToTest[i],
            originalProposalTime,
            perpsCreated[i].ancillaryData
          );
          // There should be new proposals for the identifiers:
          await verifyOracleState(
            OptimisticOracleRequestStatesEnum.PROPOSED,
            perpsCreated[i].address,
            fundingRateIdentifiersToTest[i],
            latestProposalTime,
            perpsCreated[i].ancillaryData
          );
        }
      });
      describe("Proposed rate is published, can now propose again", function () {
        beforeEach(async function () {
          // Advance time and publish proposals so that current funding rate gets set to 0.000005.
          latestProposalTime += optimisticOracleProposalLiveness;
          await timer.methods.setCurrentTime(latestProposalTime).send({ from: deployer });
          for (let i = 0; i < perpsCreated.length; i++) {
            await (await Perpetual.at(perpsCreated[i].address)).methods.applyFundingRate().send({ from: deployer });
          }
        });
        it("Skips updating funding rates that are within delta margin", async function () {
          // Now, set pricefeed price to within 10% of the current rate and check
          // that the bot skips the proposal.
          // - New funding rate is: 0.000005
          // - Bot will skip proposal if pricefeed is approximately between [0.00000477, 0.00000527].
          let pricesToPropose = [
            "0.0000049", // Within error bounds, NOT proposed
            "0.0000051", // Within error bounds, NOT proposed
            "0.0000046", // Outside error bounds, proposed
            "0.0000054", // Outside error bounds, proposed
          ];
          assert.equal(pricesToPropose.length, fundingRateIdentifiersToTest.length);
          for (let i = 0; i < fundingRateIdentifiersToTest.length; i++) {
            const priceFeed = proposer.priceFeedCache[hexToUtf8(fundingRateIdentifiersToTest[i])];
            priceFeed.setHistoricalPrice(pricesToPropose[i]);
            priceFeed.setLastUpdateTime(latestProposalTime);
          }

          // Update and check that only 2 new proposals are made.
          // latestProposalTime += 1
          // await timer.setCurrentTime(latestProposalTime);
          await proposer.update();
          await proposer.updateFundingRates(true);

          for (let i = 0; i < fundingRateIdentifiersToTest.length; i++) {
            await verifyOracleState(
              // Funding rates [0,1] were NOT updated, the others were.
              i < 2 ? OptimisticOracleRequestStatesEnum.INVALID : OptimisticOracleRequestStatesEnum.PROPOSED,
              perpsCreated[i].address,
              fundingRateIdentifiersToTest[i],
              latestProposalTime,
              perpsCreated[i].ancillaryData
            );
          }
        });
        it("Cannot propose funding rates outside config store's allowed range", async function () {
          // Set price clearly outside range bound by ConfigStore
          for (let i = 0; i < fundingRateIdentifiersToTest.length; i++) {
            const priceFeed = proposer.priceFeedCache[hexToUtf8(fundingRateIdentifiersToTest[i])];
            if (i % 2 === 0) {
              priceFeed.setHistoricalPrice("1");
            } else {
              priceFeed.setHistoricalPrice("-1");
            }
            priceFeed.setLastUpdateTime(latestProposalTime);
          }

          // Update and check that an error log was emitted
          await proposer.update();
          await proposer.updateFundingRates(true);

          // Check for the ERROR log emitted by the proposer.
          assert.equal(lastSpyLogLevel(spy), "error");
          assert.isTrue(
            spyLogIncludes(spy, -1, "Potential proposed funding rate is outside allowed funding rate range")
          );
          assert.equal(spy.getCall(-1).lastArg.minFundingRate, configStoreParams.minFundingRate.rawValue.toString());
          assert.equal(spy.getCall(-1).lastArg.maxFundingRate, configStoreParams.maxFundingRate.rawValue.toString());
        });
      });
    });
  });
  it("Emits error log for funding rate identifiers it cannot construct pricefeed for", async function () {
    const invalidPriceFeedConfig = {};
    proposer = new FundingRateProposer({
      logger: spyLogger,
      perpetualFactoryClient: factoryClient,
      multicallContractAddress: multicall.options.address,
      gasEstimator: gasEstimator,
      account: botRunner,
      commonPriceFeedConfig: invalidPriceFeedConfig,
    });

    // PriceFeedCache entries should be empty after `update()`
    await proposer.update();
    for (let i = 0; i < fundingRateIdentifiersToTest.length; i++) {
      assert.equal(proposer.priceFeedCache[hexToUtf8(fundingRateIdentifiersToTest[i])], undefined);
    }

    // Error log should be emitted on `updateFundingRates()`.
    await proposer.updateFundingRates(true);
    assert.equal(lastSpyLogLevel(spy), "error");
    assert.isTrue(spyLogIncludes(spy, -1, "Failed to create pricefeed for funding rate identifier"));
  });
  it("Emits error log for prices it cannot fetch", async function () {
    // Update once to load priceFeedCache.
    await proposer.update();

    // Force `getHistoricalPrice(x)` to return null so that bot fails to fetch prices.
    for (let i = 0; i < fundingRateIdentifiersToTest.length; i++) {
      const priceFeed = proposer.priceFeedCache[hexToUtf8(fundingRateIdentifiersToTest[i])];
      priceFeed.setHistoricalPrice(null);
    }

    // Update again
    await proposer.update();

    // Error log should be emitted on `updateFundingRates()`.
    await proposer.updateFundingRates(true);
    assert.equal(lastSpyLogLevel(spy), "error");
    assert.isTrue(spyLogIncludes(spy, -1, "Failed to query current price for funding rate identifier"));
  });
});
