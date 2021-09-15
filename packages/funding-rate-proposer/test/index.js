const Main = require("../index.js");

const winston = require("winston");
const sinon = require("sinon");

const { SpyTransport, spyLogIncludes, spyLogLevel } = require("@uma/financial-templates-lib");
const { interfaceName, RegistryRolesEnum } = require("@uma/common");
const { getAddress } = require("@uma/contracts-node");
const { assert } = require("chai");
const { deployments, getContract, web3, getChainId } = require("hardhat");

const { toWei, utf8ToHex, padRight } = web3.utils;

const PerpetualLib = getContract("PerpetualLib");
const PerpetualCreator = getContract("PerpetualCreator");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const Token = getContract("ExpandedERC20");
const AddressWhitelist = getContract("AddressWhitelist");
const Timer = getContract("Timer");
const TokenFactory = getContract("TokenFactory");
const Finder = getContract("Finder");
const Registry = getContract("Registry");
const OptimisticOracle = getContract("OptimisticOracle");
const Store = getContract("Store");
const MulticallMock = getContract("MulticallMock");

describe("index.js", function () {
  // Accounts
  let deployer;

  // Contracts
  let perpFactory;
  let identifierWhitelist;
  let collateralWhitelist;
  let collateral;
  let multicall;
  let perpsCreated = [];

  // Offchain infra
  let spyLogger;
  let spy;

  let pollingDelay = 0; // 0 polling delay creates a serverless bot that yields after one full execution.
  let errorRetries = 1;
  let errorRetriesTimeout = 0.1; // 100 milliseconds between performing retries

  // Default testing values.
  let defaultCreationParams = {
    expirationTimestamp: "1950000000", // Fri Oct 17 2031 10:40:00 GMT+0000
    priceFeedIdentifier: padRight(utf8ToHex("Test Identifier"), 64),
    fundingRateIdentifier: padRight(utf8ToHex("TEST18DECIMALS"), 64),
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
    maxFundingRate: { rawValue: toWei("1") },
    minFundingRate: { rawValue: toWei("-1") },
    proposalTimePastLimit: 1800,
  };
  // The TEST identifier will map to a PriceFeedMock, which requires the following
  // config fields to be set to construct a price feed properly:
  let commonPriceFeedConfig = { currentPrice: "1", historicalPrice: "1" };
  const optimisticOracleLiveness = 100;

  before(async function () {
    [deployer] = await web3.eth.getAccounts();

    const timer = await Timer.new().send({ from: deployer });
    const tokenFactory = await TokenFactory.new().send({ from: deployer });
    const finder = await Finder.new().send({ from: deployer });
    multicall = await MulticallMock.new().send({ from: deployer });

    // Whitelist an initial identifier so we can deploy.
    identifierWhitelist = await IdentifierWhitelist.new().send({ from: deployer });
    await identifierWhitelist.methods
      .addSupportedIdentifier(defaultCreationParams.priceFeedIdentifier)
      .send({ from: deployer });
    await identifierWhitelist.methods
      .addSupportedIdentifier(defaultCreationParams.fundingRateIdentifier)
      .send({ from: deployer });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.IdentifierWhitelist), identifierWhitelist.options.address)
      .send({ from: deployer });

    // Deploy new registry so perp factory can register contracts.
    const registry = await Registry.new().send({ from: deployer });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Registry), registry.options.address)
      .send({ from: deployer });

    // Store is neccessary to set up because contracts will need to read final fees before allowing
    // a proposal.
    const store = await Store.new({ rawValue: "0" }, { rawValue: "0" }, timer.options.address).send({ from: deployer });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Store), store.options.address)
      .send({ from: deployer });

    // Funding rates are proposed to an OptimisticOracle.
    const optimisticOracle = await OptimisticOracle.new(
      optimisticOracleLiveness,
      finder.options.address,
      timer.options.address
    ).send({ from: deployer });
    await registry.methods
      .addMember(RegistryRolesEnum.CONTRACT_CREATOR, optimisticOracle.options.address)
      .send({ from: deployer });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.OptimisticOracle), optimisticOracle.options.address)
      .send({ from: deployer });

    // Whitelist collateral and use the same collateral for all contracts.
    collateral = await Token.new("Wrapped Ether", "WETH", "18").send({ from: deployer });
    collateralWhitelist = await AddressWhitelist.new().send({ from: deployer });
    await collateralWhitelist.methods.addToWhitelist(collateral.options.address).send({ from: deployer });
    defaultCreationParams = { ...defaultCreationParams, collateralAddress: collateral.options.address };
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.CollateralWhitelist), collateralWhitelist.options.address)
      .send({ from: deployer });

    // Deploy new Perpetual factory such that it is retrievable by the client via getAddress
    // Note: use hre.deployments.deploy method to link libraries.
    const perpetualLib = await PerpetualLib.new().send({ from: deployer });
    await deployments.deploy("PerpetualCreator", {
      from: deployer,
      args: [finder.options.address, tokenFactory.options.address, timer.options.address],
      libraries: { PerpetualLib: perpetualLib.options.address },
    });
    perpFactory = await PerpetualCreator.at(await getAddress("PerpetualCreator", parseInt(await getChainId())));
    await registry.methods
      .addMember(RegistryRolesEnum.CONTRACT_CREATOR, perpFactory.options.address)
      .send({ from: deployer });

    // Deploy new Perp
    const perpAddress = await perpFactory.methods
      .createPerpetual(defaultCreationParams, configStoreParams)
      .call({ from: deployer });
    const perpCreation = await perpFactory.methods
      .createPerpetual(defaultCreationParams, configStoreParams)
      .send({ from: deployer });
    perpsCreated.push({ transaction: perpCreation, address: perpAddress });

    // This is the time that the funding rate applier's update time is initialized to:
    let contractStartTime = await timer.methods.getCurrentTime().call({ from: deployer });

    // Set the pricefeed's latestUpdateTime to be +1 second from the funding rate applier's
    // initialized update time, otherwise any proposals will fail because the new proposal timestamp
    // must always be > than the last update time.
    let lastUpdateTime = parseInt(contractStartTime) + 1;
    commonPriceFeedConfig = { ...commonPriceFeedConfig, lastUpdateTime };
    // Advance the perpetual contract forward in time to match pricefeed's update time, otherwise
    // the proposal will fail because it is "in the future".
    await timer.methods.setCurrentTime(lastUpdateTime).send({ from: deployer });
  });
  it("Completes one iteration without logging any errors", async function () {
    // We will create a new spy logger, listening for debug events because success logs are tagged with the
    // debug level.
    spy = sinon.spy();
    spyLogger = winston.createLogger({
      level: "debug",
      transports: [new SpyTransport({ level: "debug" }, { spy: spy })],
    });

    await Main.run({
      logger: spyLogger,
      web3,
      pollingDelay,
      errorRetries,
      errorRetriesTimeout,
      commonPriceFeedConfig,
      multicallAddress: multicall.options.address,
      isTest: true, // Need to set this to true so that proposal uses correct request timestamp for test environment
    });

    for (let i = 0; i < spy.callCount; i++) {
      assert.notStrictEqual(spyLogLevel(spy, i), "error");
    }

    // The first log should indicate that the Proposer runner started successfully,
    // and the second to last log should indicate that a new rate was proposed.
    assert.isTrue(spyLogIncludes(spy, 0, "Perpetual funding rate proposer started"));
    assert.isTrue(spyLogIncludes(spy, spy.callCount - 2, "Proposed new funding rate"));
    assert.isTrue(spyLogIncludes(spy, spy.callCount - 1, "End of serverless execution loop - terminating process"));
  });
});
