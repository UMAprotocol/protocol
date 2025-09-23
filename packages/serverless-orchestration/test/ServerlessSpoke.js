const { network } = require("hardhat");
const { assert } = require("chai");

// Enables testing http requests to an express spoke.
const request = require("supertest");

// Script to test
const spoke = require("../src/ServerlessSpoke");

const CUSTOM_NODE_URL = network.config.url;

// Custom winston transport module to monitor winston log outputs
const winston = require("winston");
const sinon = require("sinon");
const { SpyTransport, lastSpyLogIncludes } = require("@uma/logger");

describe("ServerlessSpoke.js", function () {
  let spy;
  let spyLogger;
  let testPort = 8080;
  let spokeInstance;

  const sendRequest = (body) => {
    return request(`http://localhost:${testPort}`).post("/").send(body).set("Accept", "application/json");
  };

  beforeEach(async function () {
    // Create a sinon spy and give it to the SpyTransport as the winston logger. Use this to check all winston logs.
    spy = sinon.spy(); // Create a new spy for each test.
    spyLogger = winston.createLogger({
      level: "info",
      transports: [new SpyTransport({ level: "debug" }, { spy: spy })],
    });

    // Start the Serverless spoke instance with the spy logger injected.
    spokeInstance = await spoke.Poll(spyLogger, testPort);
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
      serverlessCommand: "true", // Force command success.
      environmentVariables: { CUSTOM_NODE_URL },
    };

    const validResponse = await sendRequest(validBody);
    assert.equal(validResponse.res.statusCode, 200); // error code
    assert.isTrue(lastSpyLogIncludes(spy, "Process exited with no error"));
  });
  it("Serverless Spoke executes serverlessCommand in a shell", async function () {
    const validBody = {
      serverlessCommand: "test -n ${SHELL} && echo shell: ${SHELL}",
      environmentVariables: {},
    };
    const validResponse = await sendRequest(validBody);
    assert.equal(validResponse.res.statusCode, 200); // error code
  });
  it("Serverless Spoke can execute multiple chained commands with &&", async function () {
    const validBody = {
      serverlessCommand: "cd . && echo TEST_VAR=${TEST_VAR}",
      environmentVariables: { TEST_VAR: "test_value" },
    };
    const validResponse = await sendRequest(validBody);
    assert.equal(validResponse.res.statusCode, 200); // error code
    assert.isTrue(lastSpyLogIncludes(spy, "Process exited with no error")); // Verify the process completed successfully
  });
  it("Serverless Spoke can correctly returns errors over http calls", async function () {
    const body = {
      serverlessCommand: "false",
      environmentVariables: { CUSTOM_NODE_URL },
    };

    const response = await sendRequest(body);
    assert.equal(response.res.statusCode, 500); // error code
    assert.isTrue(lastSpyLogIncludes(spy, "Process exited with error")); // Check the process logger contains exit error.
  });
});
