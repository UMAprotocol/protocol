const winston = require("winston");

const { toWei, utf8ToHex, padRight } = web3.utils;

const { FinancialContractFactoryClient } = require("../../src/clients/FinancialContractFactoryClient");
const { interfaceName, advanceBlockAndSetTime, ZERO_ADDRESS, RegistryRolesEnum } = require("@uma/common");
const { getTruffleContract } = require("@uma/core");

const ExpiringMultiPartyCreator = getTruffleContract("ExpiringMultiPartyCreator", web3);
const ExpiringMultiPartyLib = getTruffleContract("ExpiringMultiPartyLib", web3);
const PerpetualCreator = getTruffleContract("PerpetualCreator", web3);
const PerpetualLib = getTruffleContract("PerpetualLib", web3);
const Finder = getTruffleContract("Finder", web3);
const IdentifierWhitelist = getTruffleContract("IdentifierWhitelist", web3);
const Token = getTruffleContract("ExpandedERC20", web3);
const TokenFactory = getTruffleContract("TokenFactory", web3);
const Timer = getTruffleContract("Timer", web3);
const AddressWhitelist = getTruffleContract("AddressWhitelist", web3);
const Registry = getTruffleContract("Registry", web3);

contract("FinancialContractFactoryClient.js", function(accounts) {
  const deployer = accounts[0];

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
    liquidationLiveness: "7300"
  };
  let defaultEmpCreationParams;
  let defaultPerpCreationParams;
  let configStoreParams = {
    timelockLiveness: 86400, // 1 day
    rewardRatePerSecond: { rawValue: toWei("0.000001") },
    proposerBondPercentage: { rawValue: toWei("0.0001") },
    maxFundingRate: { rawValue: toWei("0.00001") },
    minFundingRate: { rawValue: toWei("-0.00001") },
    proposalTimePastLimit: 1800
  };

  const deployNewContract = async type => {
    if (type === "PerpetualCreator") {
      const perpAddress = await perpFactory.createPerpetual.call(defaultPerpCreationParams, configStoreParams, {
        from: deployer
      });
      const perpCreation = await perpFactory.createPerpetual(defaultPerpCreationParams, configStoreParams, {
        from: deployer
      });
      perpsCreated.push({ transaction: perpCreation, address: perpAddress });
    } else {
      const empAddress = await empFactory.createExpiringMultiParty.call(defaultEmpCreationParams, { from: deployer });
      const empCreation = await empFactory.createExpiringMultiParty(defaultEmpCreationParams, { from: deployer });
      empsCreated.push({ transaction: empCreation, address: empAddress });
    }
  };

  before(async function() {
    finder = await Finder.new();
    const timer = await Timer.new();
    const tokenFactory = await TokenFactory.new();

    // Deploy new factories and link libraries.
    await ExpiringMultiPartyCreator.link(await ExpiringMultiPartyLib.new());
    await PerpetualCreator.link(await PerpetualLib.new());
    empFactory = await ExpiringMultiPartyCreator.new(finder.address, tokenFactory.address, timer.address);
    perpFactory = await PerpetualCreator.new(finder.address, tokenFactory.address, timer.address);

    // Whitelist an initial identifier so we can deploy.
    identifierWhitelist = await IdentifierWhitelist.new();
    await identifierWhitelist.addSupportedIdentifier(defaultCreationParams.priceFeedIdentifier);
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.IdentifierWhitelist), identifierWhitelist.address);

    // Create and whitelist collateral so we can deploy.
    collateralWhitelist = await AddressWhitelist.new();
    collateral = await Token.new("Wrapped Ether", "WETH", 18);
    await collateralWhitelist.addToWhitelist(collateral.address);
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.CollateralWhitelist), collateralWhitelist.address);

    // Add collateral to default param
    defaultCreationParams = {
      ...defaultCreationParams,
      collateralAddress: collateral.address
    };
    defaultEmpCreationParams = {
      ...defaultCreationParams,
      financialProductLibraryAddress: ZERO_ADDRESS
    };
    defaultPerpCreationParams = {
      ...defaultCreationParams,
      fundingRateIdentifier: padRight(utf8ToHex("Test Funding Rate Identifier"), 64),
      tokenScaling: { rawValue: toWei("1") }
    };

    // Add Registry to finder so factories can register contracts.
    registry = await Registry.new();
    await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, empFactory.address);
    await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, perpFactory.address);
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.Registry), registry.address);

    // Create new financial contracts:
    await deployNewContract("ExpiringMultiPartyCreator");
    await deployNewContract("PerpetualCreator");

    // The Event client does not emit any info `level` events.  Therefore no need to test Winston outputs.
    // DummyLogger will not print anything to console as only capture `info` level events.
    dummyLogger = winston.createLogger({
      level: "info",
      transports: [new winston.transports.Console()]
    });
  });
  it("createdExpiringMultiParty", async function() {
    empClient = new FinancialContractFactoryClient(
      dummyLogger,
      ExpiringMultiPartyCreator.abi,
      web3,
      empFactory.address,
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
          transactionHash: empsCreated[0].transaction.tx,
          blockNumber: empsCreated[0].transaction.receipt.blockNumber,
          deployerAddress: deployer,
          contractAddress: empsCreated[0].address
        }
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
          transactionHash: empsCreated[1].transaction.tx,
          blockNumber: empsCreated[1].transaction.receipt.blockNumber,
          deployerAddress: deployer,
          contractAddress: empsCreated[1].address
        }
      ],
      empClient.getAllCreatedContractEvents()
    );
    assert.deepStrictEqual([empsCreated[1].address], empClient.getAllCreatedContractAddresses());
  });
  it("createdPerpetual", async function() {
    perpClient = new FinancialContractFactoryClient(
      dummyLogger,
      PerpetualCreator.abi,
      web3,
      perpFactory.address,
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
          transactionHash: perpsCreated[0].transaction.tx,
          blockNumber: perpsCreated[0].transaction.receipt.blockNumber,
          deployerAddress: deployer,
          contractAddress: perpsCreated[0].address
        }
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
          transactionHash: perpsCreated[1].transaction.tx,
          blockNumber: perpsCreated[1].transaction.receipt.blockNumber,
          deployerAddress: deployer,
          contractAddress: perpsCreated[1].address
        }
      ],
      perpClient.getAllCreatedContractEvents()
    );
    assert.deepStrictEqual([perpsCreated[1].address], perpClient.getAllCreatedContractAddresses());
  });
  it("Starting client at an offset block number", async function() {
    // Init the event client with an offset block number. If the current block number is used then all log events
    // generated before the creation of the client should not be included. Rather, only subsequent logs should be reported.

    const currentBlockNumber = await web3.eth.getBlockNumber();
    const offsetClient = new FinancialContractFactoryClient(
      dummyLogger,
      PerpetualCreator.abi,
      web3,
      perpFactory.address,
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
  it("Client correctly defaults to PerpetualCreator", async function() {
    perpClient = new FinancialContractFactoryClient(
      dummyLogger,
      PerpetualCreator.abi,
      web3,
      perpFactory.address,
      0,
      null
    );
    assert.equal(perpClient.getContractType(), "PerpetualCreator");
  });
  it("Correctly rejects invalid contract types", async function() {
    let didThrow = false;
    try {
      perpClient = new FinancialContractFactoryClient(
        dummyLogger,
        PerpetualCreator.abi,
        web3,
        perpFactory.address,
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
        perpFactory.address,
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
