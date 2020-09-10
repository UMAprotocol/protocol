const { toWei, utf8ToHex } = web3.utils;

// Enables testing http requests to an express server.
const request = require("supertest");
const path = require("path");

// Script to test
const hub = require("../CloudRunHub");
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
const { SpyTransport, lastSpyLogIncludes, spyLogIncludes } = require("@umaprotocol/financial-templates-lib");

contract("CloudRunHub.js", function(accounts) {
  const contractCreator = accounts[0];

  let collateralToken;
  let syntheticToken;
  let emp;
  let uniswap;
  let defaultUniswapPricefeedConfig;

  let hubSpy;
  let hubSpyLogger;
  let hubTestPort = 8080;
  let hubInstance;

  let spokeSpy;
  let spokeSpyLogger;
  let spokeTestPort = 8081;
  let spokeInstance;

  let setEnvironmentVariableKes = []; // record all envs set within a test to unset them after in the afterEach block
  const setEnvironmentVariable = (key, value) => {
    assert(key && value, "Must provide both a key and value to set an environment variable");
    setEnvironmentVariableKes.push(key);
    process.env[key] = value;
  };
  const unsetEnvironmentVariables = () => {
    for (key of setEnvironmentVariableKes) {
      delete process.env[key];
    }
    setEnvironmentVariableKes = [];
  };

  const sendHubRequest = body => {
    return request(`http://localhost:${hubTestPort}`)
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
    hubSpy = sinon.spy(); // Create a new spy for each test.
    hubSpyLogger = winston.createLogger({
      level: "info",
      transports: [new SpyTransport({ level: "debug" }, { spy: hubSpy })]
    });
    spokeSpy = sinon.spy();
    spokeSpyLogger = winston.createLogger({
      level: "info",
      transports: [new SpyTransport({ level: "debug" }, { spy: spokeSpy })]
    });

    // Start the cloud run spoke instance with the spy logger injected.
    spokeInstance = await spoke.Poll(spokeSpyLogger, spokeTestPort);

    hubInstance = await hub.Poll(
      hubSpyLogger, // injected spy logger
      hubTestPort, // port to run the hub on
      `http://localhost:${spokeTestPort}`, // URL to execute spokes on
      web3.currentProvider.host // custom node URL to enable the hub to query block numbers.
    );

    const constructorParams = {
      expirationTimestamp: "22345678900",
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
      timerAddress: (await Timer.deployed()).address
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
    hubInstance.close();
    spokeInstance.close();
    unsetEnvironmentVariables();
  });

  it("Cloud Run Hub rejects empty json request bodies", async function() {
    // empty body.
    const emptyBody = {};
    const emptyBodyResponse = await sendHubRequest(emptyBody);
    assert.equal(emptyBodyResponse.res.statusCode, 500); // error code
    assert.isTrue(emptyBodyResponse.res.text.includes("Process exited with error"));
    assert.isTrue(emptyBodyResponse.res.text.includes("Body missing json bucket or file parameters!"));
    assert.isTrue(lastSpyLogIncludes(hubSpy, "CloudRun hub error"));
    assert.isTrue(lastSpyLogIncludes(hubSpy, "Body missing json bucket or file parameters"));
  });
  it("Cloud Run Hub rejects invalid json request bodies", async function() {
    // body missing cloud run command.
    const invalidBody = { someRandomKey: "random input" };
    const invalidBodyResponse = await sendHubRequest(invalidBody);
    assert.equal(invalidBodyResponse.res.statusCode, 500); // error code
    assert.isTrue(invalidBodyResponse.res.text.includes("Process exited with error"));
    assert.isTrue(invalidBodyResponse.res.text.includes("Body missing json bucket or file parameters!"));
    assert.isTrue(lastSpyLogIncludes(hubSpy, "CloudRun hub error"));
    assert.isTrue(lastSpyLogIncludes(hubSpy, "Body missing json bucket or file parameters"));
  });
  it("Cloud Run Hub can correctly execute bot logic with valid body and config(localStorage)", async function() {
    // Set up the environment for testing. For these tests the hub is tested in `localStorage` mode where it will
    // read in hub configs and previous block numbers from the local storage of machine. This execution mode would be
    // used by a user running the hub-spoke on their local machine.
    const testBucket = "test-bucket"; // name of the config bucket.
    const testConfigFile = "test-config-file"; // name of the config file.
    const startingBlockNumber = await web3.eth.getBlockNumber(); // block number to search from for monitor

    const hubConfig = {
      testCloudRunMonitor: {
        cloudRunCommand: `truffle exec ${path.resolve(__dirname)}/../../../../monitors/index.js --network test`,
        environmentVariables: {
          BOT_IDENTIFIER: "test-serverless-monitor",
          CUSTOM_NODE_URL: web3.currentProvider.host,
          POLLING_DELAY: 0,
          EMP_ADDRESS: emp.address,
          TOKEN_PRICE_FEED_CONFIG: defaultUniswapPricefeedConfig
        }
      }
    };
    // Set env variables for the hub to pull from. Add the startingBlockNumber and the hubConfig.
    setEnvironmentVariable(`lastQueriedBlockNumber-${testConfigFile}`, startingBlockNumber);
    setEnvironmentVariable(`${testBucket}-${testConfigFile}`, JSON.stringify(hubConfig));

    const validBody = { bucket: testBucket, configFile: testConfigFile };

    const validResponse = await sendHubRequest(validBody);
    assert.equal(validResponse.res.statusCode, 200); // no error code
    assert.isTrue(validResponse.res.text.includes("All calls returned correctly")); // Final text in monitor loop.
    assert.isTrue(lastSpyLogIncludes(hubSpy, "All calls returned correctly")); // The hub should have exited correctly.
    assert.isTrue(lastSpyLogIncludes(spokeSpy, "Process exited correctly")); // The spoke should have exited correctly.
    assert.isTrue(lastSpyLogIncludes(spokeSpy, `startingBlock: ${startingBlockNumber + 1}`)); // The spoke should have the correct starting block number.
    assert.isTrue(lastSpyLogIncludes(hubSpy, -3, `botsExecuted: ${JSON.stringify(Object.keys(hubConfig))}`)); // all bots within the config should have been reported to be executed.
  });
  it("Cloud Run Hub can correctly execute multiple bots in parallel", async function() {
    // Set up the environment for testing. For these tests the hub is tested in `localStorage` mode where it will
    // read in hub configs and previous block numbers from the local storage of machine. This execution mode would be
    // used by a user running the hub-spoke on their local machine.
    const testBucket = "test-bucket"; // name of the config bucket.
    const testConfigFile = "test-config-file"; // name of the config file.
    const startingBlockNumber = await web3.eth.getBlockNumber(); // block number to search from for monitor

    const hubConfig = {
      testServerlessMonitor: {
        cloudRunCommand: `truffle exec ${path.resolve(__dirname)}/../../../../monitors/index.js --network test`,
        environmentVariables: {
          BOT_IDENTIFIER: "test-serverless-monitor",
          CUSTOM_NODE_URL: web3.currentProvider.host,
          POLLING_DELAY: 0,
          EMP_ADDRESS: emp.address,
          TOKEN_PRICE_FEED_CONFIG: defaultUniswapPricefeedConfig
        }
      },
      testCloudRunLiquidator: {
        cloudRunCommand: `truffle exec ${path.resolve(__dirname)}/../../../../liquidator/index.js --network test`,
        environmentVariables: {
          BOT_IDENTIFIER: "test-serverless-liquidator",
          CUSTOM_NODE_URL: web3.currentProvider.host,
          POLLING_DELAY: 0,
          EMP_ADDRESS: emp.address,
          PRICE_FEED_CONFIG: defaultUniswapPricefeedConfig
        }
      },
      testCloudRunDisputer: {
        cloudRunCommand: `truffle exec ${path.resolve(__dirname)}/../../../../disputer/index.js --network test`,
        environmentVariables: {
          BOT_IDENTIFIER: "test-serverless-disputer",
          CUSTOM_NODE_URL: web3.currentProvider.host,
          POLLING_DELAY: 0,
          EMP_ADDRESS: emp.address,
          PRICE_FEED_CONFIG: defaultUniswapPricefeedConfig
        }
      }
    };
    // Set env variables for the hub to pull from. Add the startingBlockNumber and the hubConfig.
    setEnvironmentVariable(`lastQueriedBlockNumber-${testConfigFile}`, startingBlockNumber);
    setEnvironmentVariable(`${testBucket}-${testConfigFile}`, JSON.stringify(hubConfig));

    const validBody = { bucket: testBucket, configFile: testConfigFile };

    const validResponse = await sendHubRequest(validBody);
    assert.equal(validResponse.res.statusCode, 200); // no error code
    assert.isTrue(validResponse.res.text.includes("All calls returned correctly")); // Final text in monitor loop.
    assert.isTrue(lastSpyLogIncludes(hubSpy, "All calls returned correctly")); // The hub should have exited correctly.
    assert.isTrue(spyLogIncludes(hubSpy, -3, `"botsExecuted":${JSON.stringify(Object.keys(hubConfig))}`)); // all bots within the config should have been reported to be executed.
    assert.isTrue(spyLogIncludes(hubSpy, -2, "Batch execution promise resolved")); // Check that all promises within the bach resolved.

    // Check that each bot identifier returned the correct exit code.
    for (const spokeConfig of Object.keys(hubConfig)) {
      const childProcessIdentifier = hubConfig[spokeConfig].environmentVariables.BOT_IDENTIFIER;
      assert.isTrue(
        spyLogIncludes(
          hubSpy,
          -2,
          `"message":"Process exited without error","childProcessIdentifier":"${childProcessIdentifier}"`
        )
      );
    }
  });
});
