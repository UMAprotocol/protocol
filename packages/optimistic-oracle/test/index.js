// Script to test
const Main = require("../index.js");

// Custom winston transport module to monitor winston log outputs
const winston = require("winston");
const sinon = require("sinon");

const hre = require("hardhat");
const { runDefaultFixture, interfaceName } = require("@uma/common");
const { getContract } = hre;
const { assert } = require("chai");

const { SpyTransport, spyLogLevel, spyLogIncludes } = require("@uma/financial-templates-lib");

const Finder = getContract("Finder");
const OptimisticOracle = getContract("OptimisticOracle");
const MockOracle = getContract("MockOracleAncillary");

describe("index.js", function () {
  let spy;
  let spyLogger;

  let pollingDelay = 0; // 0 polling delay creates a serverless bot that yields after one full execution.
  let errorRetries = 1;
  let errorRetriesTimeout = 0.1; // 100 milliseconds between performing retries

  let optimisticOracle;
  let mockOracle;

  before(async function () {
    const accounts = await web3.eth.getAccounts();
    await runDefaultFixture(hre);
    // Deploy a new OptimisticOracle.
    const finder = await Finder.deployed();
    optimisticOracle = await OptimisticOracle.deployed();
    mockOracle = await MockOracle.deployed();

    await finder.methods
      .changeImplementationAddress(web3.utils.utf8ToHex(interfaceName.Oracle), mockOracle.options.address)
      .send({ from: accounts[0] });
  });

  it("Completes one iteration without logging any errors", async function () {
    // We will create a new spy logger, listening for debug events because success logs are tagged with the
    // debug level.
    spy = sinon.spy();
    spyLogger = winston.createLogger({
      level: "debug",
      transports: [new SpyTransport({ level: "debug" }, { spy: spy })],
    });

    await Main.run({ logger: spyLogger, web3, pollingDelay, errorRetries, errorRetriesTimeout });

    for (let i = 0; i < spy.callCount; i++) {
      assert.notStrictEqual(spyLogLevel(spy, i), "error");
    }

    // The first log should indicate that the OO-Proposer runner started successfully
    // and auto detected the OO's deployed address.
    assert.isTrue(spyLogIncludes(spy, 0, "OptimisticOracle proposer started"));
    assert.isTrue(spyLogIncludes(spy, 0, optimisticOracle.options.address));
    assert.isTrue(spyLogIncludes(spy, spy.callCount - 1, "End of serverless execution loop - terminating process"));
  });
});
