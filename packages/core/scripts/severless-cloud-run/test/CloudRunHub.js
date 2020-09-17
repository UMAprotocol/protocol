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
const { SpyTransport, lastSpyLogIncludes, spyLogIncludes, lastSpyLogLevel } = require("@uma/financial-templates-lib");

contract("CloudRunHub.js", function(accounts) {
  const contractCreator = accounts[0];

  let collateralToken;
  let emp;
  let uniswap;
  let defaultUniswapPricefeedConfig;
  let identifierWhitelist;

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
    hubInstance.close();
    spokeInstance.close();
    unsetEnvironmentVariables();
  });

  it("Cloud Run Hub rejects empty json request bodies", async function() {
    // empty body.
    const emptyBody = {};
    const emptyBodyResponse = await sendHubRequest(emptyBody);
    assert.equal(emptyBodyResponse.res.statusCode, 500); // error code
    assert.isTrue(emptyBodyResponse.res.text.includes("Some spoke calls returned errors"));
    assert.isTrue(emptyBodyResponse.res.text.includes("Body missing json bucket or file parameters!"));
    assert.isTrue(lastSpyLogIncludes(hubSpy, "Some spoke calls returned errors"));
    assert.isTrue(lastSpyLogIncludes(hubSpy, "Body missing json bucket or file parameters"));
  });
  it("Cloud Run Hub rejects invalid json request bodies", async function() {
    // body missing cloud run command.
    const invalidBody = { someRandomKey: "random input" };
    const invalidBodyResponse = await sendHubRequest(invalidBody);
    assert.equal(invalidBodyResponse.res.statusCode, 500); // error code
    assert.isTrue(invalidBodyResponse.res.text.includes("Some spoke calls returned errors"));
    assert.isTrue(invalidBodyResponse.res.text.includes("Body missing json bucket or file parameters!"));
    assert.isTrue(lastSpyLogIncludes(hubSpy, "Some spoke calls returned errors"));
    assert.isTrue(lastSpyLogIncludes(hubSpy, "Body missing json bucket or file parameters"));
  });
  it("Cloud Run Hub can correctly execute bot logic with valid body and config", async function() {
    // Set up the environment for testing. For these tests the hub is tested in `localStorage` mode where it will
    // read in hub configs and previous block numbers from the local storage of machine. This execution mode would be
    // used by a user running the hub-spoke on their local machine.
    const testBucket = "test-bucket"; // name of the config bucket.
    const testConfigFile = "test-config-file"; // name of the config file.
    const startingBlockNumber = await web3.eth.getBlockNumber(); // block number to search from for monitor

    const hubConfig = {
      testCloudRunMonitor: {
        cloudRunCommand: "yarn --silent monitors --network test",
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
    assert.isTrue(spyLogIncludes(hubSpy, -3, `"botsExecuted":${JSON.stringify(Object.keys(hubConfig))}`)); // all bots within the config should have been reported to be executed.
    assert.isTrue(lastSpyLogIncludes(spokeSpy, "Process exited with no error")); // The spoke should have exited correctly.
    assert.isTrue(lastSpyLogIncludes(spokeSpy, `${startingBlockNumber + 1}`)); // The spoke should have the correct starting block number.
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
        cloudRunCommand: "yarn --silent monitors --network test",
        environmentVariables: {
          BOT_IDENTIFIER: "test-serverless-monitor",
          CUSTOM_NODE_URL: web3.currentProvider.host,
          POLLING_DELAY: 0,
          EMP_ADDRESS: emp.address,
          TOKEN_PRICE_FEED_CONFIG: defaultUniswapPricefeedConfig
        }
      },
      testCloudRunLiquidator: {
        cloudRunCommand: "yarn --silent liquidator --network test",
        environmentVariables: {
          BOT_IDENTIFIER: "test-serverless-liquidator",
          CUSTOM_NODE_URL: web3.currentProvider.host,
          POLLING_DELAY: 0,
          EMP_ADDRESS: emp.address,
          PRICE_FEED_CONFIG: defaultUniswapPricefeedConfig
        }
      },
      testCloudRunDisputer: {
        cloudRunCommand: "yarn --silent disputer --network test",
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
    const responseObject = JSON.parse(validResponse.res.text); // extract json response

    // Check that the http response contains correct logs
    assert.equal(responseObject.message, "All calls returned correctly"); // Final text in monitor loop.
    assert.equal(Object.keys(responseObject.output.errorOutputs).length, 0); // should be no errors
    assert.equal(Object.keys(responseObject.output.validOutputs).length, 3); // should be 3 valid outputs

    // Check hub has correct logs.
    assert.isTrue(lastSpyLogIncludes(hubSpy, "All calls returned correctly")); // The hub should have exited correctly.
    assert.equal(lastSpyLogLevel(hubSpy), "debug"); // most recent log level should be "debug" (no error)
    assert.isTrue(spyLogIncludes(hubSpy, -3, `"botsExecuted":${JSON.stringify(Object.keys(hubConfig))}`)); // all bots within the config should have been reported to be executed.
    assert.isTrue(spyLogIncludes(hubSpy, -2, "Batch execution promise resolved")); // Check that all promises within the bach resolved.

    // Check that each bot identifier returned the correct exit code.
    for (const spokeConfig of Object.keys(hubConfig)) {
      const childProcessIdentifier = hubConfig[spokeConfig].environmentVariables.BOT_IDENTIFIER;
      assert.isTrue(
        spyLogIncludes(hubSpy, -2, `Process exited with no error","childProcessIdentifier":"${childProcessIdentifier}`)
      );
    }
  });
  it("Cloud Run Hub can correctly deal with some bots erroring out in execution", async function() {
    // Set up the environment for testing. For these tests the hub is tested in `localStorage` mode where it will
    // read in hub configs and previous block numbers from the local storage of machine. This execution mode would be
    // used by a user running the hub-spoke on their local machine.
    const testBucket = "test-bucket"; // name of the config bucket.
    const testConfigFile = "test-config-file"; // name of the config file.
    const startingBlockNumber = await web3.eth.getBlockNumber(); // block number to search from for monitor

    const hubConfig = {
      testServerlessMonitor: {
        // Creates no error.
        cloudRunCommand: "yarn --silent monitors --network test",
        environmentVariables: {
          BOT_IDENTIFIER: "test-serverless-monitor",
          CUSTOM_NODE_URL: web3.currentProvider.host,
          POLLING_DELAY: 0,
          EMP_ADDRESS: emp.address,
          TOKEN_PRICE_FEED_CONFIG: defaultUniswapPricefeedConfig
        }
      },
      testServerlessMonitorError: {
        // Create an error in the execution path. Child process spoke will crash.
        cloudRunCommand: "yarn --silent INVALID --network test",
        environmentVariables: {
          BOT_IDENTIFIER: "test-serverless-monitor-error",
          CUSTOM_NODE_URL: web3.currentProvider.host,
          POLLING_DELAY: 0,
          EMP_ADDRESS: emp.address,
          PRICE_FEED_CONFIG: defaultUniswapPricefeedConfig
        }
      },
      testServerlessMonitorError2: {
        // Create an error in the execution path. Child process will run but will throw an error.
        cloudRunCommand: "yarn --silent monitors --network test",
        environmentVariables: {
          BOT_IDENTIFIER: "test-serverless-monitor-error2",
          CUSTOM_NODE_URL: web3.currentProvider.host,
          POLLING_DELAY: 0,
          EMP_ADDRESS: "0x0000000000000000000000000000000000000000",
          PRICE_FEED_CONFIG: defaultUniswapPricefeedConfig
        }
      }
    };
    // Set env variables for the hub to pull from. Add the startingBlockNumber and the hubConfig.
    setEnvironmentVariable(`lastQueriedBlockNumber-${testConfigFile}`, startingBlockNumber);
    setEnvironmentVariable(`${testBucket}-${testConfigFile}`, JSON.stringify(hubConfig));

    const errorBody = { bucket: testBucket, configFile: testConfigFile };

    const errorResponse = await sendHubRequest(errorBody);

    assert.equal(errorResponse.res.statusCode, 500); // error code
    const responseObject = JSON.parse(errorResponse.res.text); // extract json response

    // Check that the http response contains correct logs
    assert.equal(responseObject.message, "Some spoke calls returned errors"); // Final text in monitor loop.
    assert.isTrue(lastSpyLogIncludes(hubSpy, "Some spoke calls returned errors")); // The hub should have exited correctly.
    assert.equal(lastSpyLogLevel(hubSpy), "error"); // most recent log level should be "error"
    assert.equal(Object.keys(responseObject.output.errorOutputs).length, 2); // should be 2 errors
    assert.equal(Object.keys(responseObject.output.validOutputs).length, 1); // should be 1 valid output

    // Check the valid outputs.
    assert.equal(responseObject.output.validOutputs["testServerlessMonitor"].botIdentifier, "testServerlessMonitor"); // Check that the valid output is the expected bot
    assert.isTrue(
      responseObject.output.validOutputs["testServerlessMonitor"].execResponse.stdout.includes(
        "End of serverless execution loop - terminating process"
      )
    );

    // Check the error outputs.
    assert.equal(
      responseObject.output.errorOutputs["testServerlessMonitorError"].botIdentifier,
      "testServerlessMonitorError"
    ); // Check that the valid output is the expected bot
    assert.equal(
      responseObject.output.errorOutputs["testServerlessMonitorError2"].botIdentifier,
      "testServerlessMonitorError2"
    ); // Check that the valid output is the expected bot
    assert.isTrue(
      responseObject.output.errorOutputs["testServerlessMonitorError"].execResponse.stderr.includes(
        "error Command INVALID not found"
      )
    ); // invalid path error
    assert.isTrue(
      responseObject.output.errorOutputs["testServerlessMonitorError2"].execResponse.stderr.includes(
        "Returned values aren't valid, did it run Out of Gas?"
      )
    ); // invalid emp error
  });
});
