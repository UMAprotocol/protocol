const assert = require("assert");

// Script to test
const Main = require("../index.js");

// Custom winston transport module to monitor winston log outputs
const winston = require("winston");
const sinon = require("sinon");
const { SpyTransport, spyLogLevel, spyLogIncludes } = require("@uma/financial-templates-lib");

describe("index.js", function() {
  // Runner input params.
  let defaultConfig = {
    name: "TEST BOT"
  };
  let defaultSetupFunc = async () => true;
  let defaultPollingFunc = async () => true;

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

  it("Config must have required fields", async function() {
    let errorThrown = false;
    try {
      await Main.run({
        logger: spyLogger,
        setupFunc: defaultSetupFunc,
        pollingFunc: defaultPollingFunc,
        pollingDelay,
        errorRetries,
        errorRetriesTimeout,
        config: {} // Pass an invalid config.
      });
    } catch (err) {
      errorThrown = true;
    }

    assert.ok(errorThrown);
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
      setupFunc: defaultSetupFunc,
      pollingFunc: defaultPollingFunc,
      pollingDelay,
      errorRetries,
      errorRetriesTimeout,
      config: defaultConfig
    });

    for (let i = 0; i < spy.callCount; i++) {
      assert.notStrictEqual(spyLogLevel(spy, i), "error");
    }

    // Logger should emit two logs: one indicating the start of the runner, and one about the early termination of the
    // of the loop because the pollingDelay is set to 0.
    assert.strictEqual(spy.getCalls().length, 2);
    assert.ok(spyLogIncludes(spy, 0, "TEST BOT started"));
    assert.ok(spyLogIncludes(spy, 1, "End of serverless execution loop - terminating process"));
  });
  it("setupFunc throws an error", async function() {
    let errorThrown = false;
    try {
      await Main.run({
        logger: spyLogger,
        setupFunc: async () => {
          throw new Error("test");
        },
        pollingFunc: defaultPollingFunc,
        pollingDelay,
        errorRetries,
        errorRetriesTimeout,
        config: defaultConfig
      });
    } catch (err) {
      errorThrown = true;
    }

    assert.ok(errorThrown);
  });
  describe("pollingFunc throws an error", async function() {
    it("Throws error after retrying", async function() {
      let errorThrown = false;
      try {
        await Main.run({
          logger: spyLogger,
          setupFunc: defaultSetupFunc,
          pollingFunc: async () => {
            throw new Error("test");
          },
          pollingDelay,
          errorRetries,
          errorRetriesTimeout,
          config: defaultConfig
        });
      } catch (err) {
        errorThrown = true;
      }

      assert.ok(errorThrown);
    });
    it("Attempts to retry after failed execution loop", async function() {
      errorRetries = 3; // set execution retries to 3 to validate.

      // We will also create a new spy logger, listening for debug events because retry logs are tagged at the
      // debug level.
      spyLogger = winston.createLogger({
        level: "debug",
        transports: [new SpyTransport({ level: "debug" }, { spy: spy })]
      });

      let errorThrown = false;
      try {
        await Main.run({
          logger: spyLogger,
          setupFunc: defaultSetupFunc,
          pollingFunc: async () => {
            throw new Error("test");
          },
          pollingDelay,
          errorRetries,
          errorRetriesTimeout,
          config: defaultConfig
        });
      } catch (err) {
        errorThrown = true; // Error should eventually be thrown.
      }

      // Iterate over all log events and count the number of execution loop errors.
      let reTryCounts = {
        executionLoopErrors: 0
      };
      for (let i = 0; i < spy.callCount; i++) {
        if (spyLogIncludes(spy, i, "An error was thrown in the execution loop")) reTryCounts.executionLoopErrors += 1;
      }
      assert.strictEqual(reTryCounts.executionLoopErrors, 3); // Each re-try create a log. These only occur on re-try and so expect 3 logs.

      // After retries, an error should be thrown.
      assert.ok(errorThrown);
    });
  });
});
