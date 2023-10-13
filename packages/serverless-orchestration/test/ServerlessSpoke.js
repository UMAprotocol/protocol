const hre = require("hardhat");
const { assert } = require("chai");
const { web3, getContract } = hre;

// Enables testing http requests to an express spoke.
const request = require("supertest");

// Script to test
const spoke = require("../src/ServerlessSpoke");

// Contract to monitor
const OptimisticOracleV2 = getContract("OptimisticOracleV2");

// Custom winston transport module to monitor winston log outputs
const winston = require("winston");
const sinon = require("sinon");
const { SpyTransport, lastSpyLogIncludes } = require("@uma/financial-templates-lib");
const { runDefaultFixture } = require("@uma/common");

describe("ServerlessSpoke.js", function () {
  let optimisticOracleV2Address;

  let spy;
  let spyLogger;
  let testPort = 8080;
  let spokeInstance;

  const sendRequest = (body) => {
    return request(`http://localhost:${testPort}`).post("/").send(body).set("Accept", "application/json");
  };

  before(async function () {
    await runDefaultFixture(hre);
  });

  beforeEach(async function () {
    // Create a sinon spy and give it to the SpyTransport as the winston logger. Use this to check all winston logs.
    spy = sinon.spy(); // Create a new spy for each test.
    spyLogger = winston.createLogger({
      level: "info",
      transports: [new SpyTransport({ level: "debug" }, { spy: spy })],
    });

    // Start the Serverless spoke instance with the spy logger injected.
    spokeInstance = await spoke.Poll(spyLogger, testPort);

    // Get deployed OptimisticOracleV2 address to monitor.
    optimisticOracleV2Address = (await OptimisticOracleV2.deployed()).options.address;
  });
  afterEach(async function () {
    spokeInstance.close();
  });

  it("Serverless Spoke rejects empty json request bodies", async function () {
    // empty body.
    const emptyBody = {};
    const emptyBodyResponse = await sendRequest(emptyBody);
    assert.equal(emptyBodyResponse.res.statusCode, 500); // error code
    assert.isTrue(emptyBodyResponse.res.text.includes("Process exited with error"));
    assert.isTrue(emptyBodyResponse.res.text.includes("Missing serverlessCommand in json body"));
    assert.isTrue(lastSpyLogIncludes(spy, "Process exited with error"));
    assert.isTrue(lastSpyLogIncludes(spy, "Missing serverlessCommand in json body"));
  });
  it("Serverless Spoke rejects invalid json request bodies", async function () {
    // body missing Serverless command.
    const invalidBody = { someRandomKey: "random input" };
    const invalidBodyResponse = await sendRequest(invalidBody);
    assert.equal(invalidBodyResponse.res.statusCode, 500); // error code
    assert.isTrue(invalidBodyResponse.res.text.includes("Process exited with error"));
    assert.isTrue(invalidBodyResponse.res.text.includes("Missing serverlessCommand in json body"));
    assert.isTrue(lastSpyLogIncludes(spy, "Process exited with error"));
    assert.isTrue(lastSpyLogIncludes(spy, "Missing serverlessCommand in json body"));
  });
  it("Serverless Spoke can correctly execute bot logic with valid body", async function () {
    const validBody = {
      serverlessCommand: "yarn --silent monitors --network test",
      environmentVariables: {
        CUSTOM_NODE_URL: web3.currentProvider.host, // ensures that script runs correctly in tests & CI.
        POLLING_DELAY: 0,
        OPTIMISTIC_ORACLE_ADDRESS: optimisticOracleV2Address,
        OPTIMISTIC_ORACLE_TYPE: "OptimisticOracleV2",
      },
    };

    const validResponse = await sendRequest(validBody);
    assert.equal(validResponse.res.statusCode, 200); // error code
    assert.isTrue(validResponse.res.text.includes("End of serverless execution loop - terminating process")); // Final text in monitor loop.
    assert.isFalse(validResponse.res.text.includes("[error]")); // There should be no error logs in a valid execution.
    assert.isFalse(validResponse.res.text.includes("[info]")); // There should be no info logs in a valid execution.
    assert.isTrue(lastSpyLogIncludes(spy, "Process exited with no error"));
  });
  it("Serverless Spoke can correctly returns errors over http calls(invalid path)", async function () {
    // Invalid path should error out when trying to run an executable that does not exist
    const invalidPathBody = {
      serverlessCommand: "yarn --silent INVALID --network test",
      environmentVariables: {
        CUSTOM_NODE_URL: web3.currentProvider.host,
        POLLING_DELAY: 0,
        OPTIMISTIC_ORACLE_ADDRESS: optimisticOracleV2Address,
        OPTIMISTIC_ORACLE_TYPE: "OptimisticOracleV2",
      },
    };

    const invalidPathResponse = await sendRequest(invalidPathBody);
    assert.equal(invalidPathResponse.res.statusCode, 500); // error code
    // Expected error text from an invalid path
    assert.isTrue(invalidPathResponse.res.text.includes("Command INVALID not found")); // Check the HTTP response.
    assert.isTrue(lastSpyLogIncludes(spy, "Command INVALID not found")); // Check the process logger contained the error.
    assert.isTrue(lastSpyLogIncludes(spy, "Process exited with error")); // Check the process logger contains exit error.
  });
  it("Serverless Spoke can correctly returns errors over http calls(invalid body)", async function () {
    // Invalid config should error out before entering the main while loop in the bot.
    const invalidConfigBody = {
      serverlessCommand: "yarn --silent monitors --network test",
      environmentVariables: {
        CUSTOM_NODE_URL: web3.currentProvider.host,
        POLLING_DELAY: 0,
        // missing OPTIMISTIC_ORACLE_ADDRESS. Should error before entering main while loop.
      },
    };

    const invalidConfigResponse = await sendRequest(invalidConfigBody);
    assert.equal(invalidConfigResponse.res.statusCode, 500); // error code
    // Expected error text from an invalid path
    assert.isTrue(
      invalidConfigResponse.res.text.includes(
        "Bad environment variables! Specify an OPTIMISTIC_ORACLE_ADDRESS, EMP_ADDRESS or FINANCIAL_CONTRACT_ADDRESS"
      )
    );
    assert.isTrue(
      lastSpyLogIncludes(
        spy,
        "Bad environment variables! Specify an OPTIMISTIC_ORACLE_ADDRESS, EMP_ADDRESS or FINANCIAL_CONTRACT_ADDRESS"
      )
    ); // Check the process logger contained the error.
    assert.isTrue(lastSpyLogIncludes(spy, "Process exited with error")); // Check the process logger contains exit error.
  });
  it("Serverless Spoke can correctly returns errors over http calls(invalid oo)", async function () {
    // Invalid OPTIMISTIC_ORACLE_ADDRESS address should error out when trying to retrieve on-chain data.
    const invalidOOAddressBody = {
      serverlessCommand: "yarn --silent monitors --network test",
      environmentVariables: {
        CUSTOM_NODE_URL: web3.currentProvider.host,
        POLLING_DELAY: 0,
        OPTIMISTIC_ORACLE_ADDRESS: "0x0000000000000000000000000000000000000000", // Invalid address that should generate an error
      },
    };

    const invalidOOAddressResponse = await sendRequest(invalidOOAddressBody);
    assert.equal(invalidOOAddressResponse.res.statusCode, 500); // error code
    // Expected error text from loading in an OO from an invalid address
    assert.isTrue(invalidOOAddressResponse.res.text.includes("Returned values aren't valid")); // error text
    assert.isTrue(lastSpyLogIncludes(spy, "Returned values aren't valid")); // Check the process logger contained the error.
    assert.isTrue(lastSpyLogIncludes(spy, "Process exited with error")); // Check the process logger contains exit error.
  });
});
