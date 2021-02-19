const { toWei, utf8ToHex } = web3.utils;

// Enables testing http requests to an express spoke.
const request = require("supertest");

// Script to test
const spoke = require("../src/ServerlessSpoke");

// Contracts and helpers
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const Finder = artifacts.require("Finder");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const TokenFactory = artifacts.require("TokenFactory");
const Token = artifacts.require("ExpandedERC20");
const Timer = artifacts.require("Timer");
const UniswapMock = artifacts.require("UniswapMock");
const SyntheticToken = artifacts.require("SyntheticToken");

// Custom winston transport module to monitor winston log outputs
const winston = require("winston");
const sinon = require("sinon");
const { SpyTransport, lastSpyLogIncludes } = require("@uma/financial-templates-lib");
const { ZERO_ADDRESS } = require("@uma/common");

contract("ServerlessSpoke.js", function(accounts) {
  const contractDeployer = accounts[0];

  let collateralToken;
  let syntheticToken;
  let emp;
  let uniswap;
  let defaultPricefeedConfig;

  let spy;
  let spyLogger;
  let testPort = 8080;
  let spokeInstance;

  const sendRequest = body => {
    return request(`http://localhost:${testPort}`)
      .post("/")
      .send(body)
      .set("Accept", "application/json");
  };

  before(async function() {
    collateralToken = await Token.new("Wrapped Ether", "WETH", 18, { from: contractDeployer });
    syntheticToken = await SyntheticToken.new("Test Synthetic Token", "SYNTH", 18, {
      from: contractDeployer
    });

    // Create identifier whitelist and register the price tracking ticker with it.
    const identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(utf8ToHex("ETH/BTC"));
  });

  beforeEach(async function() {
    // Create a sinon spy and give it to the SpyTransport as the winston logger. Use this to check all winston logs.
    spy = sinon.spy(); // Create a new spy for each test.
    spyLogger = winston.createLogger({
      level: "info",
      transports: [new SpyTransport({ level: "debug" }, { spy: spy })]
    });

    // Start the Serverless spoke instance with the spy logger injected.
    spokeInstance = await spoke.Poll(spyLogger, testPort);

    const constructorParams = {
      expirationTimestamp: "12345678900",
      withdrawalLiveness: "1000",
      collateralAddress: collateralToken.address,
      finderAddress: (await Finder.deployed()).address,
      tokenFactoryAddress: (await TokenFactory.deployed()).address,
      priceFeedIdentifier: utf8ToHex("ETH/BTC"), // Note: an identifier which is part of the default config is required for this test.
      tokenAddress: syntheticToken.address,
      liquidationLiveness: "1000",
      collateralRequirement: { rawValue: toWei("1.2") },
      disputeBondPct: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPct: { rawValue: toWei("0.1") },
      disputerDisputeRewardPct: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") },
      timerAddress: (await Timer.deployed()).address,
      excessTokenBeneficiary: ZERO_ADDRESS,
      financialProductLibraryAddress: ZERO_ADDRESS
    };

    // Deploy a new expiring multi party
    emp = await ExpiringMultiParty.new(constructorParams);

    uniswap = await UniswapMock.new();

    defaultPricefeedConfig = {
      type: "test",
      currentPrice: "1",
      historicalPrice: "1"
    };

    // Set two uniswap prices to give it a little history.
    await uniswap.setPrice(toWei("1"), toWei("1"));
    await uniswap.setPrice(toWei("1"), toWei("1"));
  });
  afterEach(async function() {
    spokeInstance.close();
  });

  it("Serverless Spoke rejects empty json request bodies", async function() {
    // empty body.
    const emptyBody = {};
    const emptyBodyResponse = await sendRequest(emptyBody);
    assert.equal(emptyBodyResponse.res.statusCode, 500); // error code
    assert.isTrue(emptyBodyResponse.res.text.includes("Process exited with error"));
    assert.isTrue(emptyBodyResponse.res.text.includes("Missing serverlessCommand in json body"));
    assert.isTrue(lastSpyLogIncludes(spy, "Process exited with error"));
    assert.isTrue(lastSpyLogIncludes(spy, "Missing serverlessCommand in json body"));
  });
  it("Serverless Spoke rejects invalid json request bodies", async function() {
    // body missing Serverless command.
    const invalidBody = { someRandomKey: "random input" };
    const invalidBodyResponse = await sendRequest(invalidBody);
    assert.equal(invalidBodyResponse.res.statusCode, 500); // error code
    assert.isTrue(invalidBodyResponse.res.text.includes("Process exited with error"));
    assert.isTrue(invalidBodyResponse.res.text.includes("Missing serverlessCommand in json body"));
    assert.isTrue(lastSpyLogIncludes(spy, "Process exited with error"));
    assert.isTrue(lastSpyLogIncludes(spy, "Missing serverlessCommand in json body"));
  });
  it("Serverless Spoke can correctly execute bot logic with valid body", async function() {
    const validBody = {
      serverlessCommand: "yarn --silent monitors --network test",
      environmentVariables: {
        CUSTOM_NODE_URL: web3.currentProvider.host, // ensures that script runs correctly in tests & CI.
        POLLING_DELAY: 0,
        EMP_ADDRESS: emp.address,
        TOKEN_PRICE_FEED_CONFIG: defaultPricefeedConfig,
        MONITOR_CONFIG: { contractVersion: "latest", contractType: "ExpiringMultiParty" }
      }
    };

    const validResponse = await sendRequest(validBody);
    assert.equal(validResponse.res.statusCode, 200); // error code
    assert.isTrue(validResponse.res.text.includes("End of serverless execution loop - terminating process")); // Final text in monitor loop.
    assert.isFalse(validResponse.res.text.includes("[error]")); // There should be no error logs in a valid execution.
    assert.isFalse(validResponse.res.text.includes("[info]")); // There should be no info logs in a valid execution.
    assert.isTrue(lastSpyLogIncludes(spy, "Process exited with no error"));
  });
  it("Serverless Spoke can correctly returns errors over http calls(invalid path)", async function() {
    // Invalid path should error out when trying to run an executable that does not exist
    const invalidPathBody = {
      serverlessCommand: "yarn --silent INVALID --network test",
      environmentVariables: {
        CUSTOM_NODE_URL: web3.currentProvider.host,
        POLLING_DELAY: 0,
        EMP_ADDRESS: emp.address,
        TOKEN_PRICE_FEED_CONFIG: defaultPricefeedConfig // invalid config that should generate an error
      }
    };

    const invalidPathResponse = await sendRequest(invalidPathBody);
    assert.equal(invalidPathResponse.res.statusCode, 500); // error code
    // Expected error text from an invalid path
    assert.isTrue(invalidPathResponse.res.text.includes("Command INVALID not found")); // Check the HTTP response.
    assert.isTrue(lastSpyLogIncludes(spy, "Command INVALID not found")); // Check the process logger contained the error.
    assert.isTrue(lastSpyLogIncludes(spy, "Process exited with error")); // Check the process logger contains exit error.
  });
  it("Serverless Spoke can correctly returns errors over http calls(invalid body)", async function() {
    // Invalid config should error out before entering the main while loop in the bot.
    const invalidConfigBody = {
      serverlessCommand: "yarn --silent monitors --network test",
      environmentVariables: {
        CUSTOM_NODE_URL: web3.currentProvider.host,
        POLLING_DELAY: 0,
        // missing EMP_ADDRESS. Should error before entering main while loop.
        TOKEN_PRICE_FEED_CONFIG: defaultPricefeedConfig, // invalid config that should generate an error
        MONITOR_CONFIG: { contractVersion: "latest", contractType: "ExpiringMultiParty" }
      }
    };

    const invalidConfigResponse = await sendRequest(invalidConfigBody);
    assert.equal(invalidConfigResponse.res.statusCode, 500); // error code
    // Expected error text from an invalid path
    assert.isTrue(invalidConfigResponse.res.text.includes("Bad environment variables! Specify an EMP_ADDRESS"));
    assert.isTrue(lastSpyLogIncludes(spy, "Bad environment variables! Specify an EMP_ADDRESS")); // Check the process logger contained the error.
    assert.isTrue(lastSpyLogIncludes(spy, "Process exited with error")); // Check the process logger contains exit error.
  });
  it("Serverless Spoke can correctly returns errors over http calls(invalid network identifier)", async function() {
    // Invalid price feed config should error out before entering main while loop
    const invalidPriceFeed = {
      serverlessCommand: "yarn --silent monitors --network INVALID",
      environmentVariables: {
        CUSTOM_NODE_URL: web3.currentProvider.host,
        POLLING_DELAY: 0,
        EMP_ADDRESS: emp.address,
        TOKEN_PRICE_FEED_CONFIG: defaultPricefeedConfig,
        MONITOR_CONFIG: { contractVersion: "latest", contractType: "ExpiringMultiParty" }
      }
    };

    const invalidPriceFeedResponse = await sendRequest(invalidPriceFeed);
    assert.equal(invalidPriceFeedResponse.res.statusCode, 500); // error code
    // Expected error text from a null price feed
    assert.isTrue(invalidPriceFeedResponse.res.text.includes("Cannot read property 'provider' of undefined"));
    assert.isTrue(lastSpyLogIncludes(spy, "Cannot read property 'provider' of undefined")); // Check the process logger contained the error.
    assert.isTrue(lastSpyLogIncludes(spy, "Process exited with error")); // Check the process logger contains exit error.
  });
  it("Serverless Spoke can correctly returns errors over http calls(invalid emp)", async function() {
    // Invalid EMP address should error out when trying to retrieve on-chain data.
    const invalidEMPAddressBody = {
      serverlessCommand: "yarn --silent monitors --network test",
      environmentVariables: {
        CUSTOM_NODE_URL: web3.currentProvider.host,
        POLLING_DELAY: 0,
        EMP_ADDRESS: "0x0000000000000000000000000000000000000000", // Invalid address that should generate an error
        TOKEN_PRICE_FEED_CONFIG: defaultPricefeedConfig,
        MONITOR_CONFIG: { contractVersion: "latest", contractType: "ExpiringMultiParty" }
      }
    };

    const invalidEMPAddressResponse = await sendRequest(invalidEMPAddressBody);
    assert.equal(invalidEMPAddressResponse.res.statusCode, 500); // error code
    // Expected error text from loading in an EMP from an invalid address
    assert.isTrue(invalidEMPAddressResponse.res.text.includes("Returned values aren't valid, did it run Out of Gas?")); // error text
    assert.isTrue(lastSpyLogIncludes(spy, "Returned values aren't valid, did it run Out of Gas?")); // Check the process logger contained the error.
    assert.isTrue(lastSpyLogIncludes(spy, "Process exited with error")); // Check the process logger contains exit error.
  });
});
