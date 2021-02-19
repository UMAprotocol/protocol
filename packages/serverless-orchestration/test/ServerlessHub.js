const { toWei, utf8ToHex } = web3.utils;

// Enables testing http requests to an express server.
const request = require("supertest");

// Script to test
const hub = require("../src/ServerlessHub");
const spoke = require("../src/ServerlessSpoke");

// Helper scripts to test different kind of rejection behaviou.
const timeoutSpoke = require("../test-helpers/TimeoutSpokeMock.js");

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
const { SpyTransport, lastSpyLogIncludes, spyLogIncludes, lastSpyLogLevel } = require("@uma/financial-templates-lib");
const { ZERO_ADDRESS } = require("@uma/common");

contract("ServerlessHub.js", function(accounts) {
  const contractDeployer = accounts[0];

  let collateralToken;
  let syntheticToken;
  let emp;
  let uniswap;
  let defaultPricefeedConfig;
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
    for (let key of setEnvironmentVariableKes) {
      delete process.env[key];
    }
    setEnvironmentVariableKes = [];
  };

  const sendHubRequest = (body, port = hubTestPort) => {
    return request(`http://localhost:${port}`)
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

    // Start the serverless spoke instance with the spy logger injected.
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
      tokenAddress: syntheticToken.address,
      finderAddress: (await Finder.deployed()).address,
      tokenFactoryAddress: (await TokenFactory.deployed()).address,
      priceFeedIdentifier: utf8ToHex("ETH/BTC"),
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
    hubInstance.close();
    spokeInstance.close();
    unsetEnvironmentVariables();
  });

  it("ServerlessHub rejects empty json request bodies", async function() {
    // empty body.
    const emptyBody = {};
    const emptyBodyResponse = await sendHubRequest(emptyBody);

    // Error in the Hub itself should not append any error messages
    assert.equal(emptyBodyResponse.res.statusCode, 500); // error code
    assert.isTrue(emptyBodyResponse.res.text.includes("A fatal error occurred in the hub"));
    assert.isTrue(emptyBodyResponse.res.text.includes("Body missing json bucket or file parameters!"));
    assert.isTrue(lastSpyLogIncludes(hubSpy, "A fatal error occurred in the hub"));
    assert.isTrue(lastSpyLogIncludes(hubSpy, "Body missing json bucket or file parameters"));
  });
  it("ServerlessHub rejects invalid json request bodies", async function() {
    // body missing serverless command.
    const invalidBody = { someRandomKey: "random input" };
    const invalidBodyResponse = await sendHubRequest(invalidBody);

    // Error in the Hub itself should not append any error messages
    assert.equal(invalidBodyResponse.res.statusCode, 500); // error code
    assert.isTrue(invalidBodyResponse.res.text.includes("A fatal error occurred in the hub"));
    assert.isTrue(invalidBodyResponse.res.text.includes("Body missing json bucket or file parameters!"));
    assert.isTrue(lastSpyLogIncludes(hubSpy, "A fatal error occurred in the hub"));
    assert.isTrue(lastSpyLogIncludes(hubSpy, "Body missing json bucket or file parameters"));
  });
  it("ServerlessHub can correctly execute bot logic with valid body and config", async function() {
    // Set up the environment for testing. For these tests the hub is tested in `localStorage` mode where it will
    // read in hub configs and previous block numbers from the local storage of machine. This execution mode would be
    // used by a user running the hub-spoke on their local machine.
    const testBucket = "test-bucket"; // name of the config bucket.
    const testConfigFile = "test-config-file"; // name of the config file.
    const startingBlockNumber = await web3.eth.getBlockNumber(); // block number to search from for monitor

    const hubConfig = {
      testServerlessMonitor: {
        serverlessCommand: "yarn --silent monitors --network test",
        environmentVariables: {
          CUSTOM_NODE_URL: web3.currentProvider.host,
          POLLING_DELAY: 0,
          EMP_ADDRESS: emp.address,
          TOKEN_PRICE_FEED_CONFIG: defaultPricefeedConfig,
          MONITOR_CONFIG: { contractVersion: "latest", contractType: "ExpiringMultiParty" }
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
    assert.isTrue(spyLogIncludes(hubSpy, -2, `"botsExecuted":${JSON.stringify(Object.keys(hubConfig))}`)); // all bots within the config should have been reported to be executed.
    assert.isTrue(lastSpyLogIncludes(spokeSpy, "Process exited with no error")); // The spoke should have exited correctly.
    assert.isTrue(lastSpyLogIncludes(spokeSpy, `${startingBlockNumber + 1}`)); // The spoke should have the correct starting block number.
  });

  it("ServerlessHub correctly deals with rejected spoke calls", async function() {
    // valid config to send but set the spoke to be off-line
    const testBucket = "test-bucket"; // name of the config bucket.
    const testConfigFile = "test-config-file"; // name of the config file.
    const startingBlockNumber = await web3.eth.getBlockNumber(); // block number to search from for monitor

    const hubConfig = {
      testServerlessMonitor: {
        serverlessCommand: "yarn --silent monitors --network test",
        environmentVariables: {
          CUSTOM_NODE_URL: web3.currentProvider.host,
          POLLING_DELAY: 0,
          EMP_ADDRESS: emp.address,
          TOKEN_PRICE_FEED_CONFIG: defaultPricefeedConfig,
          MONITOR_CONFIG: { contractVersion: "latest", contractType: "ExpiringMultiParty" }
        }
      }
    };
    // Set env variables for the hub to pull from. Add the startingBlockNumber and the hubConfig.
    setEnvironmentVariable(`lastQueriedBlockNumber-${testConfigFile}`, startingBlockNumber);
    setEnvironmentVariable(`${testBucket}-${testConfigFile}`, JSON.stringify(hubConfig));

    const validBody = {
      bucket: testBucket,
      configFile: testConfigFile
    };

    const testHubPort = 8082; // create a separate port to run this specific test on.
    // Create a hub instance with invalid spoke port. This will force the spoke to reject
    await hub.Poll(
      hubSpyLogger, // injected spy logger
      testHubPort, // port to run the hub for this test on
      "http://localhost:11111", // URL to execute spokes on
      web3.currentProvider.host // custom node URL to enable the hub to query block numbers.
    );

    // not a port the spoke is running on. will get rejected
    const rejectedResponse = await sendHubRequest(validBody, testHubPort);

    assert.equal(JSON.parse(rejectedResponse.res.text).output.retriedOutputs.length, 1); // There should be 1 retried output.
    assert.isTrue(spyLogIncludes(hubSpy, -3, "One or more spoke calls were rejected - Retrying"));
    assert.isTrue(spyLogIncludes(hubSpy, -3, "retriedOutputs"));
    assert.equal(rejectedResponse.res.statusCode, 500); // error code
    assert.isTrue(rejectedResponse.res.text.includes("Some spoke calls returned errors"));
    assert.isTrue(rejectedResponse.res.text.includes("rejected"));
    assert.isTrue(lastSpyLogIncludes(hubSpy, "Some spoke calls returned errors"));
    assert.isTrue(lastSpyLogIncludes(hubSpy, "rejected"));
  });
  it("ServerlessHub correctly deals with timeout spoke calls", async function() {
    // valid config to send but set the spoke to be off-line.
    const testBucket = "test-bucket"; // name of the config bucket.
    const testConfigFile = "test-config-file"; // name of the config file.
    const startingBlockNumber = await web3.eth.getBlockNumber(); // block number to search from for monitor

    const hubConfig = {
      testServerlessMonitor: {
        serverlessCommand: "yarn --silent monitors --network test",
        environmentVariables: {
          CUSTOM_NODE_URL: web3.currentProvider.host,
          POLLING_DELAY: 0,
          EMP_ADDRESS: emp.address,
          TOKEN_PRICE_FEED_CONFIG: defaultPricefeedConfig,
          MONITOR_CONFIG: { contractVersion: "latest", contractType: "ExpiringMultiParty" }
        }
      }
    };
    // Set env variables for the hub to pull from. Add the startingBlockNumber and the hubConfig.
    setEnvironmentVariable(`lastQueriedBlockNumber-${testConfigFile}`, startingBlockNumber);
    setEnvironmentVariable(`${testBucket}-${testConfigFile}`, JSON.stringify(hubConfig));

    const validBody = {
      bucket: testBucket,
      configFile: testConfigFile
    };

    // start the timoutSpokemock on a new port. Set the timeout for the response to be 5 seconds.
    const timeoutSpokeInstance = await timeoutSpoke.Poll(8083, 5);

    const testHubPort = 8084; // create a separate port to run this specific test on.
    // Create a hub instance with invalid spoke port. This will force the spoke to reject
    await hub.Poll(
      hubSpyLogger, // injected spy logger
      testHubPort, // port to run the hub for this test on
      "http://localhost:8083", // URL to execute spokes on
      web3.currentProvider.host, // custom node URL to enable the hub to query block numbers.
      { rejectSpokeDelay: 1 }
    );

    // not a port the spoke is running on. will get rejected

    const rejectedResponse = await sendHubRequest(validBody, testHubPort);

    assert.equal(JSON.parse(rejectedResponse.res.text).output.retriedOutputs.length, 1); // There should be 1 retried output.
    assert.isTrue(spyLogIncludes(hubSpy, -3, "One or more spoke calls were rejected - Retrying"));
    assert.isTrue(spyLogIncludes(hubSpy, -3, "retriedOutputs"));
    assert.equal(rejectedResponse.res.statusCode, 500); // error code
    assert.isTrue(rejectedResponse.res.text.includes("Some spoke calls returned errors"));
    assert.isTrue(rejectedResponse.res.text.includes("The spoke call took longer than 1 seconds to reply"));
    assert.isTrue(rejectedResponse.res.text.includes("retriedOutputs"));
    assert.isTrue(lastSpyLogIncludes(hubSpy, "Some spoke calls returned errors"));

    timeoutSpokeInstance.close();
  });
  it("ServerlessHub can correctly execute multiple bots in parallel", async function() {
    // Set up the environment for testing. For these tests the hub is tested in `localStorage` mode where it will
    // read in hub configs and previous block numbers from the local storage of machine. This execution mode would be
    // used by a user running the hub-spoke on their local machine.
    const testBucket = "test-bucket"; // name of the config bucket.
    const testConfigFile = "test-config-file"; // name of the config file.
    const startingBlockNumber = await web3.eth.getBlockNumber(); // block number to search from for monitor

    const hubConfig = {
      testServerlessMonitor: {
        serverlessCommand: "yarn --silent monitors --network test",
        environmentVariables: {
          CUSTOM_NODE_URL: web3.currentProvider.host,
          POLLING_DELAY: 0,
          EMP_ADDRESS: emp.address,
          TOKEN_PRICE_FEED_CONFIG: defaultPricefeedConfig,
          MONITOR_CONFIG: { contractVersion: "latest", contractType: "ExpiringMultiParty" }
        }
      },
      testServerlessLiquidator: {
        serverlessCommand: "yarn --silent liquidator --network test",
        environmentVariables: {
          CUSTOM_NODE_URL: web3.currentProvider.host,
          POLLING_DELAY: 0,
          EMP_ADDRESS: emp.address,
          PRICE_FEED_CONFIG: defaultPricefeedConfig,
          LIQUIDATOR_CONFIG: { contractVersion: "latest", contractType: "ExpiringMultiParty" }
        }
      },
      testServerlessDisputer: {
        serverlessCommand: "yarn --silent disputer --network test",
        environmentVariables: {
          CUSTOM_NODE_URL: web3.currentProvider.host,
          POLLING_DELAY: 0,
          EMP_ADDRESS: emp.address,
          PRICE_FEED_CONFIG: defaultPricefeedConfig,
          DISPUTER_CONFIG: { contractVersion: "latest", contractType: "ExpiringMultiParty" }
        }
      }
    };
    // Set env variables for the hub to pull from. Add the startingBlockNumber and the hubConfig.
    setEnvironmentVariable(`lastQueriedBlockNumber-${testConfigFile}`, startingBlockNumber);
    setEnvironmentVariable(`${testBucket}-${testConfigFile}`, JSON.stringify(hubConfig));

    const validBody = {
      bucket: testBucket,
      configFile: testConfigFile
    };

    const validResponse = await sendHubRequest(validBody);
    assert.equal(validResponse.res.statusCode, 200); // no error code

    // Check that the http response contains correct logs
    const responseObject = JSON.parse(validResponse.res.text); // extract json response
    assert.equal(responseObject.message, "All calls returned correctly"); // Final text in monitor loop.
    assert.equal(Object.keys(responseObject.output.errorOutputs).length, 0); // should be no errors
    assert.equal(Object.keys(responseObject.output.validOutputs).length, 3); // should be 3 valid outputs

    // Check hub has correct logs.
    assert.isTrue(lastSpyLogIncludes(hubSpy, "All calls returned correctly")); // The hub should have exited correctly.
    assert.equal(lastSpyLogLevel(hubSpy), "debug"); // most recent log level should be "debug" (no error)
    assert.isTrue(spyLogIncludes(hubSpy, -2, `"botsExecuted":${JSON.stringify(Object.keys(hubConfig))}`)); // all bots within the config should have been reported to be executed.

    // Check that each bot identifier returned the correct exit code within the final hub log.
    const lastSpyHubLog = hubSpy.getCall(-1).lastArg;
    for (const logObject of Object.keys(lastSpyHubLog.output.validOutputs)) {
      assert.isTrue(logObject.indexOf("End of serverless execution loop - terminating process") != 0);
    }
  });
  it("ServerlessHub can correctly deal with some bots erroring out in execution", async function() {
    // Set up the environment for testing. For these tests the hub is tested in `localStorage` mode where it will
    // read in hub configs and previous block numbers from the local storage of machine. This execution mode would be
    // used by a user running the hub-spoke on their local machine.
    const testBucket = "test-bucket"; // name of the config bucket.
    const testConfigFile = "test-config-file"; // name of the config file.
    const startingBlockNumber = await web3.eth.getBlockNumber(); // block number to search from for monitor

    const hubConfig = {
      testServerlessMonitor: {
        // Creates no error.
        serverlessCommand: "yarn --silent monitors --network test",
        environmentVariables: {
          CUSTOM_NODE_URL: web3.currentProvider.host,
          POLLING_DELAY: 0,
          EMP_ADDRESS: emp.address,
          TOKEN_PRICE_FEED_CONFIG: defaultPricefeedConfig,
          MONITOR_CONFIG: { contractVersion: "latest", contractType: "ExpiringMultiParty" }
        }
      },
      testServerlessMonitorError: {
        // Create an error in the execution path. Child process spoke will crash.
        serverlessCommand: "yarn --silent INVALID --network test",
        environmentVariables: {
          CUSTOM_NODE_URL: web3.currentProvider.host,
          POLLING_DELAY: 0,
          EMP_ADDRESS: emp.address,
          PRICE_FEED_CONFIG: defaultPricefeedConfig
        }
      },
      testServerlessMonitorError2: {
        // Create an error in the execution path. Child process will run but will throw an error.
        serverlessCommand: "yarn --silent monitors --network test",
        environmentVariables: {
          CUSTOM_NODE_URL: web3.currentProvider.host,
          POLLING_DELAY: 0,
          EMP_ADDRESS: "0x0000000000000000000000000000000000000000",
          PRICE_FEED_CONFIG: defaultPricefeedConfig,
          MONITOR_CONFIG: { contractVersion: "latest", contractType: "ExpiringMultiParty" }
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

    // Check the error outputs form the hub logger and the hub response.
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
    assert.isTrue(lastSpyLogIncludes(hubSpy, "error Command INVALID not found"));
    assert.isTrue(
      responseObject.output.errorOutputs["testServerlessMonitorError2"].execResponse.stderr.includes(
        "Returned values aren't valid, did it run Out of Gas?"
      )
    ); // invalid emp error
    assert.isTrue(lastSpyLogIncludes(hubSpy, "Returned values aren't valid, did it run Out of Gas?"));
  });
});
