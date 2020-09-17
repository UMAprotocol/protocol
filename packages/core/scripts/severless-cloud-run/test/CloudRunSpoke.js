const { toWei, utf8ToHex } = web3.utils;

// Enables testing http requests to an express spoke.
const request = require("supertest");
const path = require("path");

// Script to test
const spoke = require("../CloudRunSpoke");

// Contracts and helpers
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const Finder = artifacts.require("Finder");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const TokenFactory = artifacts.require("TokenFactory");
const Token = artifacts.require("ExpandedERC20");
const Timer = artifacts.require("Timer");
const UniswapMock = artifacts.require("UniswapMock");

// Custom winston transport module to monitor winston log outputs
const winston = require("winston");
const sinon = require("sinon");
const { SpyTransport, lastSpyLogIncludes } = require("@uma/financial-templates-lib");

contract("CloudRunSpoke.js", function(accounts) {
  const contractCreator = accounts[0];

  let collateralToken;
  let syntheticToken;
  let emp;
  let uniswap;
  let defaultUniswapPricefeedConfig;

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
    collateralToken = await Token.new("DAI", "DAI", 18, { from: contractCreator });

    // Create identifier whitelist and register the price tracking ticker with it.
    identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(utf8ToHex("ETH/BTC"));
  });

  beforeEach(async function() {
    // Create a sinon spy and give it to the SpyTransport as the winston logger. Use this to check all winston logs.
    spy = sinon.spy(); // Create a new spy for each test.
    spyLogger = winston.createLogger({
      level: "info",
      transports: [new SpyTransport({ level: "debug" }, { spy: spy })]
    });

    // Start the cloud run spoke instance with the spy logger injected.
    spokeInstance = await spoke.Poll(spyLogger, testPort);

    const constructorParams = {
      expirationTimestamp: "12345678900",
      withdrawalLiveness: "1000",
      collateralAddress: collateralToken.address,
      finderAddress: (await Finder.deployed()).address,
      tokenFactoryAddress: (await TokenFactory.deployed()).address,
      priceFeedIdentifier: utf8ToHex("ETH/BTC"),
      syntheticName: "ETH/BTC synthetic token",
      syntheticSymbol: "ETH/BTC",
      liquidationLiveness: "1000",
      collateralRequirement: { rawValue: toWei("1.2") },
      disputeBondPct: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPct: { rawValue: toWei("0.1") },
      disputerDisputeRewardPct: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") },
      timerAddress: (await Timer.deployed()).address,
      excessTokenBeneficiary: "0x0000000000000000000000000000000000000000"
    };

    // Deploy a new expiring multi party
    emp = await ExpiringMultiParty.new(constructorParams);

    syntheticToken = await Token.at(await emp.tokenCurrency());

    uniswap = await UniswapMock.new();

    defaultUniswapPricefeedConfig = {
      type: "uniswap",
      uniswapAddress: uniswap.address,
      twapLength: 1,
      lookback: 1
    };

    // Set two uniswap prices to give it a little history.
    await uniswap.setPrice(toWei("1"), toWei("1"));
    await uniswap.setPrice(toWei("1"), toWei("1"));
  });
  afterEach(async function() {
    spokeInstance.close();
  });

  it("Cloud Run Spoke rejects empty json request bodies", async function() {
    // empty body.
    const emptyBody = {};
    const emptyBodyResponse = await sendRequest(emptyBody);
    assert.equal(emptyBodyResponse.res.statusCode, 500); // error code
    assert.isTrue(emptyBodyResponse.res.text.includes("Process exited with error"));
    assert.isTrue(emptyBodyResponse.res.text.includes("Missing cloudRunCommand in json body"));
    assert.isTrue(lastSpyLogIncludes(spy, "Process exited with error"));
    assert.isTrue(lastSpyLogIncludes(spy, "Missing cloudRunCommand in json body"));
  });
  it("Cloud Run Spoke rejects invalid json request bodies", async function() {
    // body missing cloud run command.
    const invalidBody = { someRandomKey: "random input" };
    const invalidBodyResponse = await sendRequest(invalidBody);
    assert.equal(invalidBodyResponse.res.statusCode, 500); // error code
    assert.isTrue(invalidBodyResponse.res.text.includes("Process exited with error"));
    assert.isTrue(invalidBodyResponse.res.text.includes("Missing cloudRunCommand in json body"));
    assert.isTrue(lastSpyLogIncludes(spy, "Process exited with error"));
    assert.isTrue(lastSpyLogIncludes(spy, "Missing cloudRunCommand in json body"));
  });
  it("Cloud Run Spoke can correctly execute bot logic with valid body", async function() {
    const validBody = {
      cloudRunCommand: "yarn --silent monitors --network test",
      environmentVariables: {
        CUSTOM_NODE_URL: web3.currentProvider.host, // ensures that script runs correctly in tests & CI.
        POLLING_DELAY: 0,
        EMP_ADDRESS: emp.address,
        TOKEN_PRICE_FEED_CONFIG: defaultUniswapPricefeedConfig
      }
    };

    const validResponse = await sendRequest(validBody);
    assert.equal(validResponse.res.statusCode, 200); // error code
    assert.isTrue(validResponse.res.text.includes("End of serverless execution loop - terminating process")); // Final text in monitor loop.
    assert.isFalse(validResponse.res.text.includes("[error]")); // There should be no error logs in a valid execution.
    assert.isFalse(validResponse.res.text.includes("[info]")); // There should be no info logs in a valid execution.
    assert.isTrue(lastSpyLogIncludes(spy, "Process exited with no error"));
  });
  it("Cloud Run Spoke can correctly returns errors over http calls(invalid path)", async function() {
    // Invalid path should error out when trying to run an executable that does not exist
    const invalidPathBody = {
      cloudRunCommand: "yarn --silent INVALID --network test",
      environmentVariables: {
        CUSTOM_NODE_URL: web3.currentProvider.host,
        POLLING_DELAY: 0,
        EMP_ADDRESS: emp.address,
        TOKEN_PRICE_FEED_CONFIG: defaultUniswapPricefeedConfig // invalid config that should generate an error
      }
    };

    const invalidPathResponse = await sendRequest(invalidPathBody);
    console.log("invalidPathResponse", invalidPathResponse);
    assert.equal(invalidPathResponse.res.statusCode, 500); // error code
    // Expected error text from an invalid path
    assert.isTrue(invalidPathResponse.res.text.includes("Command INVALID not found")); // Check the HTTP response.
    assert.isTrue(lastSpyLogIncludes(spy, "Command INVALID not found")); // Check the process logger contained the error.
    assert.isTrue(lastSpyLogIncludes(spy, "Process exited with error")); // Check the process logger contains exit error.
  });
  it("Cloud Run Spoke can correctly returns errors over http calls(invalid body)", async function() {
    // Invalid config should error out before entering the main while loop in the bot.
    const invalidConfigBody = {
      cloudRunCommand: "yarn --silent monitors --network test",
      environmentVariables: {
        CUSTOM_NODE_URL: web3.currentProvider.host,
        POLLING_DELAY: 0,
        // missing EMP_ADDRESS. Should error before entering main while loop.
        TOKEN_PRICE_FEED_CONFIG: defaultUniswapPricefeedConfig // invalid config that should generate an error
      }
    };

    const invalidConfigResponse = await sendRequest(invalidConfigBody);
    assert.equal(invalidConfigResponse.res.statusCode, 500); // error code
    // Expected error text from an invalid path
    assert.isTrue(invalidConfigResponse.res.text.includes("Bad environment variables! Specify an `EMP_ADDRESS`"));
    assert.isTrue(lastSpyLogIncludes(spy, "Bad environment variables! Specify an `EMP_ADDRESS`")); // Check the process logger contained the error.
    assert.isTrue(lastSpyLogIncludes(spy, "Process exited with error")); // Check the process logger contains exit error.
  });
  it("Cloud Run Spoke can correctly returns errors over http calls(invalid network identifier)", async function() {
    // Invalid price feed config should error out before entering main while loop
    const invalidPriceFeed = {
      cloudRunCommand: "yarn --silent monitors --network INVALID",
      environmentVariables: {
        CUSTOM_NODE_URL: web3.currentProvider.host,
        POLLING_DELAY: 0,
        EMP_ADDRESS: emp.address,
        TOKEN_PRICE_FEED_CONFIG: defaultUniswapPricefeedConfig
      }
    };

    const invalidPriceFeedResponse = await sendRequest(invalidPriceFeed);
    assert.equal(invalidPriceFeedResponse.res.statusCode, 500); // error code
    // Expected error text from a null price feed
    assert.isTrue(invalidPriceFeedResponse.res.text.includes("Cannot read property 'provider' of undefined"));
    assert.isTrue(lastSpyLogIncludes(spy, "Cannot read property 'provider' of undefined")); // Check the process logger contained the error.
    assert.isTrue(lastSpyLogIncludes(spy, "Process exited with error")); // Check the process logger contains exit error.
  });
  it("Cloud Run Spoke can correctly returns errors over http calls(invalid emp)", async function() {
    // Invalid EMP address should error out when trying to retrieve on-chain data.
    const invalidEMPAddressBody = {
      cloudRunCommand: "yarn --silent monitors --network test",
      environmentVariables: {
        CUSTOM_NODE_URL: web3.currentProvider.host,
        POLLING_DELAY: 0,
        EMP_ADDRESS: "0x0000000000000000000000000000000000000000", // Invalid address that should generate an error
        TOKEN_PRICE_FEED_CONFIG: defaultUniswapPricefeedConfig
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
