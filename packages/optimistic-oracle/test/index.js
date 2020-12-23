// Script to test
const Main = require("../index.js");

// Custom winston transport module to monitor winston log outputs
const winston = require("winston");
const sinon = require("sinon");
const { SpyTransport, spyLogLevel, spyLogIncludes } = require("@uma/financial-templates-lib");

contract("index.js", function() {
  let spy;
  let spyLogger;

  let pollingDelay = 0; // 0 polling delay creates a serverless bot that yields after one full execution.
  let errorRetries = 1;
  let errorRetriesTimeout = 0.1; // 100 milliseconds between preforming retries

  beforeEach(async function() {
    // Create a sinon spy and give it to the SpyTransport as the winston logger. Use this to check all winston logs.
    spy = sinon.spy(); // Create a new spy for each test.
    spyLogger = winston.createLogger({
      level: "info",
      transports: [new SpyTransport({ level: "info" }, { spy: spy })]
    });
  });

  it("Completes one iteration without logging any errors", async function() {
    // We will also create a new spy logger, listening for debug events because success logs are tagged with the
    // debug level.
    spyLogger = winston.createLogger({
      level: "debug",
      transports: [new SpyTransport({ level: "debug" }, { spy: spy })]
    });

    await Main.run({
      logger: spyLogger,
      web3,
      pollingDelay,
      errorRetries,
      errorRetriesTimeout
    });

    for (let i = 0; i < spy.callCount; i++) {
      assert.notStrictEqual(spyLogLevel(spy, i), "error");
    }

    // Logger should emit two logs: one indicating the start of the runner, and one about the early termination of the
    // of the loop because the pollingDelay is set to 0.
    assert.strictEqual(spy.getCalls().length, 2);
    assert.isTrue(spyLogIncludes(spy, 0, "OO keeper started"));
    assert.isTrue(spyLogIncludes(spy, 1, "End of serverless execution loop - terminating process"));
  });
});
