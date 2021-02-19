// Script to test
const Main = require("../index.js");

// Custom winston transport module to monitor winston log outputs
const winston = require("winston");
const sinon = require("sinon");

const { SpyTransport, spyLogLevel, spyLogIncludes } = require("@uma/financial-templates-lib");
const { getTruffleContract } = require("@uma/core");
const { addGlobalHardhatTestingAddress } = require("@uma/common");

const CONTRACT_VERSION = "latest";

const OptimisticOracle = getTruffleContract("OptimisticOracle", web3, CONTRACT_VERSION);
const MockOracle = getTruffleContract("MockOracleAncillary", web3, CONTRACT_VERSION);
const Finder = getTruffleContract("Finder", web3, CONTRACT_VERSION);
const Timer = getTruffleContract("Timer", web3, CONTRACT_VERSION);

contract("index.js", function() {
  let spy;
  let spyLogger;

  let pollingDelay = 0; // 0 polling delay creates a serverless bot that yields after one full execution.
  let errorRetries = 1;
  let errorRetriesTimeout = 0.1; // 100 milliseconds between preforming retries

  let finder;
  let timer;
  let optimisticOracle;
  let mockOracle;

  before(async function() {
    finder = await Finder.new();
    timer = await Timer.new();
    mockOracle = await MockOracle.new(finder.address, timer.address);

    // Deploy a new OptimisticOracle.
    optimisticOracle = await OptimisticOracle.new("120", finder.address, timer.address);

    // Set addresses in the global name space that the OO proposer's index.js needs to fetch:
    addGlobalHardhatTestingAddress("OptimisticOracle", optimisticOracle.address);
    addGlobalHardhatTestingAddress("Voting", mockOracle.address);
  });
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

    // The first log should indicate that the OO-Proposer runner started successfully
    // and auto detected the OO's deployed address.
    assert.isTrue(spyLogIncludes(spy, 0, "OptimisticOracle proposer started"));
    assert.isTrue(spyLogIncludes(spy, 0, optimisticOracle.address));
    assert.isTrue(spyLogIncludes(spy, spy.callCount - 1, "End of serverless execution loop - terminating process"));
  });
});
