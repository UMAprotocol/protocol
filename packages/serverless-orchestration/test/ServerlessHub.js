const hre = require("hardhat");
const { getContract, web3, network } = hre;
const { assert } = require("chai");
const Web3 = require("web3");

// Enables testing http requests to an express server.
const request = require("supertest");

// Script to test
const hub = require("../src/ServerlessHub");
const spoke = require("../src/ServerlessSpoke");

// Helper scripts to test different kind of rejection behaviour.
const timeoutSpoke = require("../test-helpers/TimeoutSpokeMock.js");

// Contract to monitor
const OptimisticOracleV2 = getContract("OptimisticOracleV2");

// Custom winston transport module to monitor winston log outputs
const winston = require("winston");
const sinon = require("sinon");
const { SpyTransport, lastSpyLogIncludes, spyLogIncludes, lastSpyLogLevel } = require("@uma/financial-templates-lib");
const { runDefaultFixture } = require("@uma/common");

// Use Ganache to create additional web3 providers with different chain ID's
const ganache = require("ganache-core");

describe("ServerlessHub.js", function () {
  let optimisticOracleV2Address;

  let defaultPricefeedConfig;

  let hubSpy;
  let hubSpyLogger;
  let hubTestPort = 8080;
  let hubInstance;

  let spokeSpy;
  let spokeSpyLogger;
  let spokeTestPort = 8081;
  let spokeInstance;

  let defaultChainId;

  let ganacheServers = []; // keep track of all ganache instances so they can be closed after each test to avoid port conflicts

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

  const closeGanacheServers = () => {
    for (let i = ganacheServers.length - 1; i >= 0; i--) {
      const ganacheServer = ganacheServers[i];
      ganacheServer.close();
      ganacheServers.pop();
    }
  };

  const sendHubRequest = (body, port = hubTestPort) => {
    return request(`http://localhost:${port}`).post("/").send(body).set("Accept", "application/json");
  };

  const startGanacheServer = (chainId, port) => {
    const node = ganache.server({ _chainIdRpc: chainId });
    node.listen(port);
    ganacheServers.push(node);
    return new Web3("http://127.0.0.1:" + port);
  };

  before(async function () {
    defaultChainId = await web3.eth.getChainId();
    await runDefaultFixture(hre);
  });

  beforeEach(async function () {
    // Create a sinon spy and give it to the SpyTransport as the winston logger. Use this to check all winston logs.
    hubSpy = sinon.spy(); // Create a new spy for each test.
    hubSpyLogger = winston.createLogger({
      level: "info",
      transports: [new SpyTransport({ level: "debug" }, { spy: hubSpy })],
    });
    spokeSpy = sinon.spy();
    spokeSpyLogger = winston.createLogger({
      level: "info",
      transports: [new SpyTransport({ level: "debug" }, { spy: spokeSpy })],
    });

    hubInstance = await hub.Poll(
      hubSpyLogger, // injected spy logger
      hubTestPort, // port to run the hub on
      `http://localhost:${spokeTestPort}`, // URL to execute spokes on
      network.config.url, // custom node URL to enable the hub to query block numbers.
      { printHubConfig: true }, // set hub config to print config before execution.
      {
        small: `http://localhost:${spokeTestPort}`, // URL to execute spokes on
        large: `http://localhost:${spokeTestPort}`, // URL to execute spokes on
      }
    );

    // Start the serverless spoke instance with the spy logger injected.
    spokeInstance = await spoke.Poll(spokeSpyLogger, spokeTestPort);

    // Only used for testing environment variables.
    defaultPricefeedConfig = { type: "test", currentPrice: "1", historicalPrice: "1" };

    // Get deployed OptimisticOracleV2 address to monitor.
    optimisticOracleV2Address = (await OptimisticOracleV2.deployed()).options.address;
  });
  afterEach(async function () {
    hubInstance.close();
    spokeInstance.close();
    unsetEnvironmentVariables();
    closeGanacheServers();
  });

  it("ServerlessHub rejects empty json request bodies", async function () {
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
  it("ServerlessHub rejects invalid json request bodies", async function () {
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

  it("ServerlessHub can correctly execute bot logic with valid body and config", async function () {
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
          CUSTOM_NODE_URL: network.config.url,
          POLLING_DELAY: 0,
          OPTIMISTIC_ORACLE_ADDRESS: optimisticOracleV2Address,
          OPTIMISTIC_ORACLE_TYPE: "OptimisticOracleV2",
        },
      },
    };
    // Set env variables for the hub to pull from. Add the startingBlockNumber and the hubConfig.
    setEnvironmentVariable(`lastQueriedBlockNumber-${defaultChainId}-${testConfigFile}`, startingBlockNumber);
    setEnvironmentVariable(`${testBucket}-${testConfigFile}`, JSON.stringify(hubConfig));

    const validBody = { bucket: testBucket, configFile: testConfigFile };

    const validResponse = await sendHubRequest(validBody);
    assert.equal(validResponse.res.statusCode, 200); // no error code
    assert.isTrue(validResponse.res.text.includes("All calls returned correctly")); // Final text in monitor loop.
    assert.isTrue(spyLogIncludes(hubSpy, -2, "All calls returned correctly")); // The hub should have exited correctly.
    assert.isTrue(lastSpyLogIncludes(spokeSpy, "Process exited with no error")); // The spoke should have exited correctly.
    assert.isTrue(lastSpyLogIncludes(spokeSpy, `${startingBlockNumber + 1}`)); // The spoke should have the correct starting block number.
    assert.isTrue(spyLogIncludes(hubSpy, -4, startingBlockNumber), "should return block information for chain");
    assert.isTrue(spyLogIncludes(hubSpy, -4, defaultChainId), "should return chain ID");
    assert.isTrue(spyLogIncludes(hubSpy, -4, startingBlockNumber), "should return block information for chain");
    assert.isTrue(spyLogIncludes(hubSpy, -4, defaultChainId), "should return chain ID");
    assert.isTrue(spyLogIncludes(hubSpy, -5, `"botsExecuted":${JSON.stringify(Object.keys(hubConfig))}`)); // all bots within the config should have been reported to be executed.
  });
  it("ServerlessHub can correctly execute bot with named spokes", async function () {
    // Set up the environment for testing. For these tests the hub is tested in `localStorage` mode where it will
    // read in hub configs and previous block numbers from the local storage of machine. This execution mode would be
    // used by a user running the hub-spoke on their local machine.
    const testBucket = "test-bucket"; // name of the config bucket.
    const testConfigFile = "test-config-file"; // name of the config file.
    const startingBlockNumber = await web3.eth.getBlockNumber(); // block number to search from for monitor
    const defaultConfig = {
      serverlessCommand: "yarn --silent monitors --network test",
      environmentVariables: {
        CUSTOM_NODE_URL: network.config.url,
        POLLING_DELAY: 0,
        OPTIMISTIC_ORACLE_ADDRESS: optimisticOracleV2Address,
        OPTIMISTIC_ORACLE_TYPE: "OptimisticOracleV2",
      },
    };
    const hubConfig = {
      // no named spoke
      testDefaultInstance: defaultConfig,
      // one named spoke
      testSmallInstance: { ...defaultConfig, spokeUrlName: "small" },
      // other named spoke
      testLargeInstance: { ...defaultConfig, spokeUrlName: "large" },
    };
    // Set env variables for the hub to pull from. Add the startingBlockNumber and the hubConfig.
    setEnvironmentVariable(`lastQueriedBlockNumber-${defaultChainId}-${testConfigFile}`, startingBlockNumber);
    setEnvironmentVariable(`${testBucket}-${testConfigFile}`, JSON.stringify(hubConfig));

    const validBody = { bucket: testBucket, configFile: testConfigFile };
    const validResponse = await sendHubRequest(validBody);
    assert.equal(validResponse.res.statusCode, 200); // no error code
    assert.isTrue(spyLogIncludes(hubSpy, 4, "serverless spoke using named spoke small"), "should run small instance");
    assert.isTrue(spyLogIncludes(hubSpy, 5, "serverless spoke using named spoke large"), "should run large instance");
  });
  it("ServerlessHub correctly fails with an invalid named spoke", async function () {
    // Set up the environment for testing. For these tests the hub is tested in `localStorage` mode where it will
    // read in hub configs and previous block numbers from the local storage of machine. This execution mode would be
    // used by a user running the hub-spoke on their local machine.
    const testBucket = "test-bucket"; // name of the config bucket.
    const testConfigFile = "test-config-file"; // name of the config file.
    const startingBlockNumber = await web3.eth.getBlockNumber(); // block number to search from for monitor
    const defaultConfig = {
      serverlessCommand: "yarn --silent monitors --network test",
      environmentVariables: {
        CUSTOM_NODE_URL: network.config.url,
        POLLING_DELAY: 0,
        OPTIMISTIC_ORACLE_ADDRESS: optimisticOracleV2Address,
        OPTIMISTIC_ORACLE_TYPE: "OptimisticOracleV2",
      },
    };
    const hubConfig = { testInvalidInstance: { ...defaultConfig, spokeUrlName: "invalid" } };
    // Set env variables for the hub to pull from. Add the startingBlockNumber and the hubConfig.
    setEnvironmentVariable(`lastQueriedBlockNumber-${defaultChainId}-${testConfigFile}`, startingBlockNumber);
    setEnvironmentVariable(`${testBucket}-${testConfigFile}`, JSON.stringify(hubConfig));

    const validBody = { bucket: testBucket, configFile: testConfigFile };
    const response = await sendHubRequest(validBody);
    assert.equal(response.res.statusCode, 500); // no error code
  });
  it("ServerlessHub correctly deals with rejected spoke calls", async function () {
    // valid config to send but set the spoke to be off-line
    const testBucket = "test-bucket"; // name of the config bucket.
    const testConfigFile = "test-config-file"; // name of the config file.
    const startingBlockNumber = await web3.eth.getBlockNumber(); // block number to search from for monitor

    const hubConfig = {
      testServerlessMonitor: {
        serverlessCommand: "yarn --silent monitors --network test",
        environmentVariables: {
          CUSTOM_NODE_URL: network.config.url,
          POLLING_DELAY: 0,
          OPTIMISTIC_ORACLE_ADDRESS: optimisticOracleV2Address,
          OPTIMISTIC_ORACLE_TYPE: "OptimisticOracleV2",
        },
      },
    };
    // Set env variables for the hub to pull from. Add the startingBlockNumber and the hubConfig.
    setEnvironmentVariable(`lastQueriedBlockNumber-${defaultChainId}-${testConfigFile}`, startingBlockNumber);
    setEnvironmentVariable(`${testBucket}-${testConfigFile}`, JSON.stringify(hubConfig));

    const validBody = { bucket: testBucket, configFile: testConfigFile };

    const testHubPort = 8082; // create a separate port to run this specific test on.
    // Create a hub instance with invalid spoke port. This will force the spoke to reject
    await hub.Poll(
      hubSpyLogger, // injected spy logger
      testHubPort, // port to run the hub for this test on
      "http://localhost:11111", // URL to execute spokes on
      network.config.url // custom node URL to enable the hub to query block numbers.
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
  it("ServerlessHub correctly deals with timeout spoke calls", async function () {
    // valid config to send but set the spoke to be off-line.
    const testBucket = "test-bucket"; // name of the config bucket.
    const testConfigFile = "test-config-file"; // name of the config file.
    const startingBlockNumber = await web3.eth.getBlockNumber(); // block number to search from for monitor

    const hubConfig = {
      testServerlessMonitor: {
        serverlessCommand: "yarn --silent monitors --network test",
        environmentVariables: {
          CUSTOM_NODE_URL: network.config.url,
          POLLING_DELAY: 0,
          OPTIMISTIC_ORACLE_ADDRESS: optimisticOracleV2Address,
          OPTIMISTIC_ORACLE_TYPE: "OptimisticOracleV2",
        },
      },
    };
    // Set env variables for the hub to pull from. Add the startingBlockNumber and the hubConfig.
    setEnvironmentVariable(`lastQueriedBlockNumber-${defaultChainId}-${testConfigFile}`, startingBlockNumber);
    setEnvironmentVariable(`${testBucket}-${testConfigFile}`, JSON.stringify(hubConfig));

    const validBody = { bucket: testBucket, configFile: testConfigFile };

    // start the timoutSpokemock on a new port. Set the timeout for the response to be 5 seconds.
    const timeoutSpokeInstance = await timeoutSpoke.Poll(8083, 5);

    const testHubPort = 8084; // create a separate port to run this specific test on.
    // Create a hub instance with invalid spoke port. This will force the spoke to reject
    await hub.Poll(
      hubSpyLogger, // injected spy logger
      testHubPort, // port to run the hub for this test on
      "http://localhost:8083", // URL to execute spokes on
      network.config.url, // custom node URL to enable the hub to query block numbers.
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
  it("ServerlessHub can correctly execute multiple bots in parallel", async function () {
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
          CUSTOM_NODE_URL: network.config.url,
          POLLING_DELAY: 0,
          OPTIMISTIC_ORACLE_ADDRESS: optimisticOracleV2Address,
          OPTIMISTIC_ORACLE_TYPE: "OptimisticOracleV2",
        },
      },
      testServerlessMonitor2: {
        serverlessCommand: "yarn --silent monitors --network test",
        environmentVariables: {
          CUSTOM_NODE_URL: network.config.url,
          POLLING_DELAY: 0,
          OPTIMISTIC_ORACLE_ADDRESS: optimisticOracleV2Address,
          OPTIMISTIC_ORACLE_TYPE: "OptimisticOracleV2",
        },
      },
      testServerlessMonitor3: {
        serverlessCommand: "yarn --silent monitors --network test",
        environmentVariables: {
          CUSTOM_NODE_URL: network.config.url,
          POLLING_DELAY: 0,
          OPTIMISTIC_ORACLE_ADDRESS: optimisticOracleV2Address,
          OPTIMISTIC_ORACLE_TYPE: "OptimisticOracleV2",
        },
      },
    };
    // Set env variables for the hub to pull from. Add the startingBlockNumber and the hubConfig.
    setEnvironmentVariable(`lastQueriedBlockNumber-${defaultChainId}-${testConfigFile}`, startingBlockNumber);
    setEnvironmentVariable(`${testBucket}-${testConfigFile}`, JSON.stringify(hubConfig));

    const validBody = { bucket: testBucket, configFile: testConfigFile };

    const validResponse = await sendHubRequest(validBody);
    assert.equal(validResponse.res.statusCode, 200); // no error code

    // Check that the http response contains correct logs
    const responseObject = JSON.parse(validResponse.res.text); // extract json response
    assert.equal(responseObject.message, "All calls returned correctly"); // Final text in monitor loop.
    assert.equal(Object.keys(responseObject.output.errorOutputs).length, 0); // should be no errors
    assert.equal(Object.keys(responseObject.output.validOutputs).length, 3); // should be 3 valid outputs

    // Check hub has correct logs.
    assert.isTrue(spyLogIncludes(hubSpy, -4, "All calls returned correctly")); // The hub should have exited correctly.
    assert.isTrue(spyLogIncludes(hubSpy, -7, `"botsExecuted":${JSON.stringify(Object.keys(hubConfig))}`)); // all bots within the config should have been reported to be executed.
  });
  it("ServerlessHub can correctly deal with some bots erroring out in execution", async function () {
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
          CUSTOM_NODE_URL: network.config.url,
          POLLING_DELAY: 0,
          OPTIMISTIC_ORACLE_ADDRESS: optimisticOracleV2Address,
          OPTIMISTIC_ORACLE_TYPE: "OptimisticOracleV2",
        },
      },
      testServerlessMonitorError: {
        // Create an error in the execution path. Child process spoke will crash.
        serverlessCommand: "yarn --silent INVALID --network test",
        environmentVariables: {
          CUSTOM_NODE_URL: network.config.url,
          POLLING_DELAY: 0,
          OPTIMISTIC_ORACLE_ADDRESS: optimisticOracleV2Address,
          OPTIMISTIC_ORACLE_TYPE: "OptimisticOracleV2",
        },
      },
      testServerlessMonitorError2: {
        // Create an error in the execution path. Child process will run but will throw an error.
        serverlessCommand: "yarn --silent monitors --network test",
        environmentVariables: {
          CUSTOM_NODE_URL: network.config.url,
          POLLING_DELAY: 0,
          OPTIMISTIC_ORACLE_ADDRESS: "0x0000000000000000000000000000000000000000",
          OPTIMISTIC_ORACLE_TYPE: "OptimisticOracleV2",
        },
      },
    };
    // Set env variables for the hub to pull from. Add the startingBlockNumber and the hubConfig.
    setEnvironmentVariable(`lastQueriedBlockNumber-${defaultChainId}-${testConfigFile}`, startingBlockNumber);
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
        "Returned values aren't valid"
      )
    ); // invalid oo error
    assert.isTrue(lastSpyLogIncludes(hubSpy, "Returned values aren't valid"));
  });
  it("ServerlessHub can correctly inject common config into child configs", async function () {
    const testBucket = "test-bucket"; // name of the config bucket.
    const testConfigFile = "test-config-file"; // name of the config file.
    const startingBlockNumber = await web3.eth.getBlockNumber(); // block number to search from for monitor

    const hubConfig = {
      commonConfig: {
        environmentVariables: {
          SOME_TEST_ENV: "some value", // a unique env that should be appended to all.
          MONITOR_CONFIG: { optimisticOracleUIBaseUrl: "https://example.com/" }, // a repeated key and a repeated child key. should ignore
          TOKEN_PRICE_FEED_CONFIG: { someKey: "shouldAppend" }, // a clashing parent with a unique child. should append.
        },
      },
      testServerlessMonitor: {
        serverlessCommand: "yarn --silent monitors --network test",
        environmentVariables: {
          CUSTOM_NODE_URL: network.config.url,
          POLLING_DELAY: 0,
          OPTIMISTIC_ORACLE_ADDRESS: optimisticOracleV2Address,
          OPTIMISTIC_ORACLE_TYPE: "OptimisticOracleV2",
          TOKEN_PRICE_FEED_CONFIG: defaultPricefeedConfig, // not used by oo monitor, just for environment testing.
          MONITOR_CONFIG: { optimisticOracleUIBaseUrl: "https://oracle.uma.xyz" },
        },
      },
      testServerlessMonitor2: {
        serverlessCommand: "yarn --silent monitors --network test",
        environmentVariables: {
          CUSTOM_NODE_URL: network.config.url,
          POLLING_DELAY: 0,
          OPTIMISTIC_ORACLE_ADDRESS: optimisticOracleV2Address,
          OPTIMISTIC_ORACLE_TYPE: "OptimisticOracleV2",
          PRICE_FEED_CONFIG: defaultPricefeedConfig, // not used by oo monitor, just for environment testing.
          MONITOR_CONFIG: { optimisticOracleUIBaseUrl: "https://oracle.uma.xyz" },
        },
      },
      testServerlessMonitor3: {
        serverlessCommand: "yarn --silent monitors --network test",
        environmentVariables: {
          CUSTOM_NODE_URL: network.config.url,
          POLLING_DELAY: 0,
          OPTIMISTIC_ORACLE_ADDRESS: optimisticOracleV2Address,
          OPTIMISTIC_ORACLE_TYPE: "OptimisticOracleV2",
          PRICE_FEED_CONFIG: defaultPricefeedConfig, // not used by oo monitor, just for environment testing.
          MONITOR_CONFIG: { optimisticOracleUIBaseUrl: "https://oracle.uma.xyz" },
        },
      },
    };
    // Set env variables for the hub to pull from. Add the startingBlockNumber and the hubConfig.
    setEnvironmentVariable(`lastQueriedBlockNumber-${defaultChainId}-${testConfigFile}`, startingBlockNumber);
    setEnvironmentVariable(`${testBucket}-${testConfigFile}`, JSON.stringify(hubConfig));

    const body = { bucket: testBucket, configFile: testConfigFile };

    await sendHubRequest(body);

    // Check that the concatenated log was correctly constructed.
    const spyHubExecution = hubSpy.getCall(2).lastArg;

    // validate that the appending worked as expected.
    // Monitor config applied to the monitor should NOT have changed the OO URL as the monitor config should take preference.
    assert.equal(
      spyHubExecution.configObject.testServerlessMonitor.environmentVariables.MONITOR_CONFIG.optimisticOracleUIBaseUrl,
      "https://oracle.uma.xyz"
    );

    // All objects should correctly append the "SOME_TEST_ENV".
    for (const botKey in spyHubExecution.configObject) {
      const botConfig = spyHubExecution.configObject[botKey].environmentVariables;
      assert.equal(botConfig.SOME_TEST_ENV, "some value");
      // The TOKEN_PRICE_FEED_CONFIG should correctly merge in the monitor case and append in the other bots.
      if (botKey == "testServerlessMonitor") {
        const expectedConfig = { ...defaultPricefeedConfig, someKey: "shouldAppend" };
        assert.equal(
          JSON.stringify(botConfig.TOKEN_PRICE_FEED_CONFIG, Object.keys(botConfig.TOKEN_PRICE_FEED_CONFIG).sort()),
          JSON.stringify(expectedConfig, Object.keys(expectedConfig).sort())
        );
      } else {
        const expectedConfig = { someKey: "shouldAppend" };
        assert.equal(
          JSON.stringify(botConfig.TOKEN_PRICE_FEED_CONFIG, Object.keys(botConfig.TOKEN_PRICE_FEED_CONFIG).sort()),
          JSON.stringify(expectedConfig, Object.keys(expectedConfig).sort())
        );
      }
    }
  });
  it("ServerlessHub can correctly deal with multiple providers", async function () {
    const testBucket = "test-bucket"; // name of the config bucket.
    const testConfigFile = "test-config-file"; // name of the config file.
    const startingBlockNumber = await web3.eth.getBlockNumber(); // block number to search from for monitor

    // Temporarily spin up a new web3 provider with an overridden chain ID. The hub should be able to detect the
    // alternative node URL and fetch its chain ID.
    const alternateChainId = 666;
    const alternateWeb3 = startGanacheServer(alternateChainId, 7777);

    const hubConfig = {
      testServerlessMonitor: {
        serverlessCommand: "yarn --silent monitors --network test",
        environmentVariables: {
          CUSTOM_NODE_URL: network.config.url,
          POLLING_DELAY: 0,
          OPTIMISTIC_ORACLE_ADDRESS: optimisticOracleV2Address,
          OPTIMISTIC_ORACLE_TYPE: "OptimisticOracleV2",
        },
      },
      testServerlessMonitor2: {
        serverlessCommand: "yarn --silent monitors --network test",
        environmentVariables: {
          CUSTOM_NODE_URL: alternateWeb3.currentProvider.host,
          POLLING_DELAY: 0,
          OPTIMISTIC_ORACLE_ADDRESS: optimisticOracleV2Address,
          OPTIMISTIC_ORACLE_TYPE: "OptimisticOracleV2",
        },
      },
      testServerlessMonitor3: {
        serverlessCommand: "yarn --silent monitors --network test",
        environmentVariables: {
          CUSTOM_NODE_URL: alternateWeb3.currentProvider.host,
          POLLING_DELAY: 0,
          OPTIMISTIC_ORACLE_ADDRESS: optimisticOracleV2Address,
          OPTIMISTIC_ORACLE_TYPE: "OptimisticOracleV2",
        },
      },
    };

    // Set env variables for the hub to pull from. Add the startingBlockNumber and the hubConfig.
    setEnvironmentVariable(`lastQueriedBlockNumber-${defaultChainId}-${testConfigFile}`, startingBlockNumber);
    setEnvironmentVariable(`${testBucket}-${testConfigFile}`, JSON.stringify(hubConfig));
    setEnvironmentVariable(`lastQueriedBlockNumber-${666}-${testConfigFile}`, startingBlockNumber);

    const validBody = { bucket: testBucket, configFile: testConfigFile };

    const validResponse = await sendHubRequest(validBody);
    assert.equal(validResponse.res.statusCode, 200); // no error code

    // Check for two hub logs caching each unique chain ID seen:
    assert.isTrue(spyLogIncludes(hubSpy, 3, defaultChainId));
    assert.isTrue(spyLogIncludes(hubSpy, 3, alternateChainId));
  });

  it("ServerlessHub can detects errors if the spoke process has a blank stdout or missing `started`", async function () {
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
          CUSTOM_NODE_URL: network.config.url,
          POLLING_DELAY: 0,
          OPTIMISTIC_ORACLE_ADDRESS: optimisticOracleV2Address,
          OPTIMISTIC_ORACLE_TYPE: "OptimisticOracleV2",
        },
      },
      testServerlessMonitorError: {
        // Create an error in the execution path. Child process spoke will crash.
        serverlessCommand: "echo ''",
        environmentVariables: {
          CUSTOM_NODE_URL: network.config.url,
          POLLING_DELAY: 0,
          OPTIMISTIC_ORACLE_ADDRESS: optimisticOracleV2Address,
          OPTIMISTIC_ORACLE_TYPE: "OptimisticOracleV2",
        },
      },
      testServerlessMonitorError2: {
        // Create an error in the execution path. Child process will run but will throw an error.
        serverlessCommand: "echo 'something random but not the magic bot start key word'",
        environmentVariables: {
          CUSTOM_NODE_URL: network.config.url,
          POLLING_DELAY: 0,
          OPTIMISTIC_ORACLE_ADDRESS: "0x0000000000000000000000000000000000000000",
          OPTIMISTIC_ORACLE_TYPE: "OptimisticOracleV2",
        },
      },
    };
    // Set env variables for the hub to pull from. Add the startingBlockNumber and the hubConfig.
    setEnvironmentVariable(`lastQueriedBlockNumber-${defaultChainId}-${testConfigFile}`, startingBlockNumber);
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
      JSON.stringify(responseObject.output.errorOutputs["testServerlessMonitorError"]).includes("empty stdout")
    ); // check that the catcher for empty standouts correctly caught the error
    assert.isTrue(
      JSON.stringify(responseObject.output.errorOutputs["testServerlessMonitorError2"]).includes(
        "missing `started` keyword"
      )
    ); // check the catcher for missing `Started` key words, sent at the booting sequency of all bots, is captured correctly.
  });

  it("ServerlessHub sets multiple network block numbers", async function () {
    const testBucket = "test-bucket"; // name of the config bucket.
    const testConfigFile = "test-config-file"; // name of the config file.
    const startingBlockNumber = await web3.eth.getBlockNumber(); // block number to search from for monitor

    // Temporarily spin up a new web3 provider with an overridden chain ID. The hub should be able to detect the
    // alternative network when passed together with default network within the same bot config.
    const alternateChainId = 666;
    const alternateWeb3 = startGanacheServer(alternateChainId, 7777);

    const hubConfig = {
      testServerlessBot: {
        serverlessCommand: "echo single network bot started",
        environmentVariables: { CUSTOM_NODE_URL: network.config.url },
      },
      testServerlessBot2: {
        serverlessCommand: "echo multiple network bot started",
        environmentVariables: {
          [`NODE_URL_${defaultChainId}`]: network.config.url,
          [`NODE_URL_${alternateChainId}`]: alternateWeb3.currentProvider.host,
          STORE_MULTI_CHAIN_BLOCK_NUMBERS: [defaultChainId, alternateChainId],
        },
      },
    };

    // Set env variables for the hub to pull from. Add the startingBlockNumber and the hubConfig.
    setEnvironmentVariable(`lastQueriedBlockNumber-${defaultChainId}-${testConfigFile}`, startingBlockNumber);
    setEnvironmentVariable(`${testBucket}-${testConfigFile}`, JSON.stringify(hubConfig));
    setEnvironmentVariable(`lastQueriedBlockNumber-${alternateChainId}-${testConfigFile}`, startingBlockNumber);

    const validBody = { bucket: testBucket, configFile: testConfigFile };

    const validResponse = await sendHubRequest(validBody);
    assert.equal(validResponse.res.statusCode, 200); // no error code

    // Check for hub logs caching each unique chain ID seen:
    assert.isTrue(spyLogIncludes(hubSpy, 3, defaultChainId));
    assert.isTrue(spyLogIncludes(hubSpy, 3, alternateChainId));
  });

  it("ServerlessHub correctly sets latestBlockNumber in multiple network config", async function () {
    const testBucket = "test-bucket"; // name of the config bucket.
    const testConfigFile = "test-config-file"; // name of the config file.

    // Temporarily spin up a new web3 provider with an overridden chain ID. The hub should be able to store the latest
    // block number for this alternative network when passed together with default network within the same bot config.
    const alternateChainId = 666;
    const alternateWeb3 = startGanacheServer(alternateChainId, 7777);

    // Mine additional block and store its number.
    await alternateWeb3.currentProvider.send({ method: "evm_mine", params: [] });
    const latestAlternateBlockNumber = await alternateWeb3.eth.getBlockNumber();

    const hubConfig = {
      testServerlessBot: {
        serverlessCommand: "echo single network bot started",
        environmentVariables: { CUSTOM_NODE_URL: network.config.url },
      },
      testServerlessBot2: {
        serverlessCommand: "echo multiple network bot started",
        environmentVariables: {
          [`NODE_URL_${defaultChainId}`]: network.config.url,
          [`NODE_URL_${alternateChainId}`]: alternateWeb3.currentProvider.host,
          STORE_MULTI_CHAIN_BLOCK_NUMBERS: [defaultChainId, alternateChainId],
        },
      },
    };

    // Set env variables for the hub to pull from. Add the startingBlockNumber and the hubConfig.
    setEnvironmentVariable(`lastQueriedBlockNumber-${defaultChainId}-${testConfigFile}`, "0");
    setEnvironmentVariable(`${testBucket}-${testConfigFile}`, JSON.stringify(hubConfig));
    setEnvironmentVariable(`lastQueriedBlockNumber-${alternateChainId}-${testConfigFile}`, "0");

    const validBody = { bucket: testBucket, configFile: testConfigFile };

    const validResponse = await sendHubRequest(validBody);
    assert.equal(validResponse.res.statusCode, 200); // no error code

    // Logs should include correct starting and latest block numbers for the alternate network.
    const alternateBlockNumbers = {
      [alternateChainId]: {
        lastQueriedBlockNumber: latestAlternateBlockNumber, // Same as latest as this is first time bot is run.
        latestBlockNumber: latestAlternateBlockNumber,
      },
    };

    // Strip enclosing curly braces as there are also other items in the logged object.
    const alternateBlockNumbersFragment = JSON.stringify(alternateBlockNumbers).substring(
      1,
      JSON.stringify(alternateBlockNumbers).length - 1
    );

    // Check for hub logs include correct starting and latest block numbers for the alternate network:
    assert.isTrue(spyLogIncludes(hubSpy, 3, alternateBlockNumbersFragment));
  });
});
