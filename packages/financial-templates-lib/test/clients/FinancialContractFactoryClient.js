const { web3, getContract } = require("hardhat");
const { assert } = require("chai");

const winston = require("winston");

const { toWei, utf8ToHex, padRight } = web3.utils;

const { FinancialContractFactoryClient } = require("../../dist/clients/FinancialContractFactoryClient");
const { interfaceName, advanceBlockAndSetTime, ZERO_ADDRESS, RegistryRolesEnum } = require("@uma/common");

const ExpiringMultiPartyCreator = getContract("ExpiringMultiPartyCreator");
const ExpiringMultiPartyLib = getContract("ExpiringMultiPartyLib");
const PerpetualCreator = getContract("PerpetualCreator");
const PerpetualLib = getContract("PerpetualLib");
const Finder = getContract("Finder");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const Token = getContract("ExpandedERC20");
const TokenFactory = getContract("TokenFactory");
const Timer = getContract("Timer");
const AddressWhitelist = getContract("AddressWhitelist");
const Registry = getContract("Registry");

describe("FinancialContractFactoryClient.js", function () {
  let accounts;
  let deployer;

  // Contracts
  let empFactory;
  let perpFactory;
  let finder;
  let identifierWhitelist;
  let collateralWhitelist;
  let registry;
  let collateral;
  let empsCreated = [];
  let perpsCreated = [];

  // Bot helper modules
  let perpClient, empClient;
  let dummyLogger;

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
  };
  let defaultEmpCreationParams;
  let defaultPerpCreationParams;
  let configStoreParams = {
    timelockLiveness: 86400, // 1 day
    rewardRatePerSecond: { rawValue: toWei("0.000001") },
    proposerBondPercentage: { rawValue: toWei("0.0001") },
    maxFundingRate: { rawValue: toWei("0.00001") },
    minFundingRate: { rawValue: toWei("-0.00001") },
    proposalTimePastLimit: 1800,
  };

  const deployNewContract = async (type) => {
    if (type === "PerpetualCreator") {
      const perpAddress = await perpFactory.methods
        .createPerpetual(defaultPerpCreationParams, configStoreParams)
        .call({ from: deployer });
      const perpCreation = await perpFactory.methods
        .createPerpetual(defaultPerpCreationParams, configStoreParams)
        .send({ from: deployer });
      perpsCreated.push({ transaction: perpCreation, address: perpAddress });
    } else {
      const empAddress = await empFactory.methods
        .createExpiringMultiParty(defaultEmpCreationParams)
        .call({ from: deployer });
      const empCreation = await empFactory.methods
        .createExpiringMultiParty(defaultEmpCreationParams)
        .send({ from: deployer });
      empsCreated.push({ transaction: empCreation, address: empAddress });
    }
  };

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [deployer] = accounts;
    finder = await Finder.new().send({ from: accounts[0] });
    const timer = await Timer.new().send({ from: accounts[0] });
    const tokenFactory = await TokenFactory.new().send({ from: accounts[0] });

    // Deploy new factories and link libraries.
    await ExpiringMultiPartyCreator.link({
      ExpiringMultiPartyLib: (await ExpiringMultiPartyLib.new().send({ from: accounts[0] })).options.address,
    });
    await PerpetualCreator.link({
      PerpetualLib: (await PerpetualLib.new().send({ from: accounts[0] })).options.address,
    });
    empFactory = await ExpiringMultiPartyCreator.new(
      finder.options.address,
      tokenFactory.options.address,
      timer.options.address
    ).send({ from: accounts[0] });
    perpFactory = await PerpetualCreator.new(
      finder.options.address,
      tokenFactory.options.address,
      timer.options.address
    ).send({ from: accounts[0] });

    // Whitelist an initial identifier so we can deploy.
    identifierWhitelist = await IdentifierWhitelist.new().send({ from: accounts[0] });
    await identifierWhitelist.methods
      .addSupportedIdentifier(defaultCreationParams.priceFeedIdentifier)
      .send({ from: accounts[0] });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.IdentifierWhitelist), identifierWhitelist.options.address)
      .send({ from: accounts[0] });

    // Create and whitelist collateral so we can deploy.
    collateralWhitelist = await AddressWhitelist.new().send({ from: accounts[0] });
    collateral = await Token.new("Wrapped Ether", "WETH", 18).send({ from: accounts[0] });
    await collateralWhitelist.methods.addToWhitelist(collateral.options.address).send({ from: accounts[0] });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.CollateralWhitelist), collateralWhitelist.options.address)
      .send({ from: accounts[0] });

    // Add collateral to default param
    defaultCreationParams = { ...defaultCreationParams, collateralAddress: collateral.options.address };
    defaultEmpCreationParams = { ...defaultCreationParams, financialProductLibraryAddress: ZERO_ADDRESS };
    defaultPerpCreationParams = {
      ...defaultCreationParams,
      fundingRateIdentifier: padRight(utf8ToHex("Test Funding Rate Identifier"), 64),
      tokenScaling: { rawValue: toWei("1") },
    };

    // Add Registry to finder so factories can register contracts.
    registry = await Registry.new().send({ from: accounts[0] });
    await registry.methods
      .addMember(RegistryRolesEnum.CONTRACT_CREATOR, empFactory.options.address)
      .send({ from: accounts[0] });
    await registry.methods
      .addMember(RegistryRolesEnum.CONTRACT_CREATOR, perpFactory.options.address)
      .send({ from: accounts[0] });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Registry), registry.options.address)
      .send({ from: accounts[0] });

    // Create new financial contracts:
    await deployNewContract("ExpiringMultiPartyCreator");
    await deployNewContract("PerpetualCreator");

    // The Event client does not emit any info `level` events.  Therefore no need to test Winston outputs.
    // DummyLogger will not print anything to console as only capture `info` level events.
    dummyLogger = winston.createLogger({ level: "info", transports: [new winston.transports.Console()] });
  });
  it("createdExpiringMultiParty", async function () {
    empClient = new FinancialContractFactoryClient(
      dummyLogger,
      ExpiringMultiPartyCreator.abi,
      web3,
      empFactory.options.address,
      0, // startingBlockNumber
      null, // endingBlockNumber
      "ExpiringMultiPartyCreator"
    );

    await empClient.clearState();

    // State is empty before update().
    assert.deepStrictEqual([], empClient.getAllCreatedContractEvents());
    assert.deepStrictEqual([], empClient.getAllCreatedContractAddresses());

    await empClient.update();
    assert.deepStrictEqual(
      [
        {
          transactionHash: empsCreated[0].transaction.transactionHash,
          blockNumber: empsCreated[0].transaction.blockNumber,
          deployerAddress: deployer,
          contractAddress: empsCreated[0].address,
        },
      ],
      empClient.getAllCreatedContractEvents()
    );
    assert.deepStrictEqual([empsCreated[0].address], empClient.getAllCreatedContractAddresses());

    // Correctly adds only new events after last query
    await deployNewContract("ExpiringMultiPartyCreator");
    await empClient.clearState();
    await empClient.update();
    assert.deepStrictEqual(
      [
        {
          transactionHash: empsCreated[1].transaction.transactionHash,
          blockNumber: empsCreated[1].transaction.blockNumber,
          deployerAddress: deployer,
          contractAddress: empsCreated[1].address,
        },
      ],
      empClient.getAllCreatedContractEvents()
    );
    assert.deepStrictEqual([empsCreated[1].address], empClient.getAllCreatedContractAddresses());
  });
  it("createdPerpetual", async function () {
    perpClient = new FinancialContractFactoryClient(
      dummyLogger,
      PerpetualCreator.abi,
      web3,
      perpFactory.options.address,
      0, // startingBlockNumber
      null, // endingBlockNumber
      "PerpetualCreator"
    );

    await perpClient.clearState();

    // State is empty before update().
    assert.deepStrictEqual([], perpClient.getAllCreatedContractEvents());
    assert.deepStrictEqual([], perpClient.getAllCreatedContractAddresses());

    await perpClient.update();
    assert.deepStrictEqual(
      [
        {
          transactionHash: perpsCreated[0].transaction.transactionHash,
          blockNumber: perpsCreated[0].transaction.blockNumber,
          deployerAddress: deployer,
          contractAddress: perpsCreated[0].address,
        },
      ],
      perpClient.getAllCreatedContractEvents()
    );
    assert.deepStrictEqual([perpsCreated[0].address], perpClient.getAllCreatedContractAddresses());

    // Correctly adds only new events after last query
    await deployNewContract("PerpetualCreator");
    await perpClient.clearState();
    await perpClient.update();
    assert.deepStrictEqual(
      [
        {
          transactionHash: perpsCreated[1].transaction.transactionHash,
          blockNumber: perpsCreated[1].transaction.blockNumber,
          deployerAddress: deployer,
          contractAddress: perpsCreated[1].address,
        },
      ],
      perpClient.getAllCreatedContractEvents()
    );
    assert.deepStrictEqual([perpsCreated[1].address], perpClient.getAllCreatedContractAddresses());
  });
  it("Starting client at an offset block number", async function () {
    // Init the event client with an offset block number. If the current block number is used then all log events
    // generated before the creation of the client should not be included. Rather, only subsequent logs should be reported.

    const currentBlockNumber = await web3.eth.getBlockNumber();
    const offsetClient = new FinancialContractFactoryClient(
      dummyLogger,
      PerpetualCreator.abi,
      web3,
      perpFactory.options.address,
      currentBlockNumber + 1, // Start the bot one block after the latest event
      null, // endingBlockNumber
      "PerpetualCreator"
    );
    const currentTimestamp = (await web3.eth.getBlock("latest")).timestamp;
    await advanceBlockAndSetTime(web3, currentTimestamp + 1);
    await advanceBlockAndSetTime(web3, currentTimestamp + 2);
    await advanceBlockAndSetTime(web3, currentTimestamp + 3);

    await offsetClient.update();

    assert.deepStrictEqual([], offsetClient.getAllCreatedContractEvents());
    assert.deepStrictEqual([], offsetClient.getAllCreatedContractAddresses());
  });
  it("Client correctly defaults to PerpetualCreator", async function () {
    perpClient = new FinancialContractFactoryClient(
      dummyLogger,
      PerpetualCreator.abi,
      web3,
      perpFactory.options.address,
      0,
      null
    );
    assert.equal(perpClient.getContractType(), "PerpetualCreator");
  });
  it("Correctly rejects invalid contract types", async function () {
    let didThrow = false;
    try {
      perpClient = new FinancialContractFactoryClient(
        dummyLogger,
        PerpetualCreator.abi,
        web3,
        perpFactory.options.address,
        0,
        null,
        "ExpiringMultiParty"
      );
    } catch (error) {
      didThrow = true;
    }
    assert.isTrue(didThrow);
    didThrow = false;
    try {
      perpClient = new FinancialContractFactoryClient(
        dummyLogger,
        PerpetualCreator.abi,
        web3,
        perpFactory.options.address,
        0,
        null,
        "Perpetual"
      );
    } catch (error) {
      didThrow = true;
    }
    assert.isTrue(didThrow);
  });
});
