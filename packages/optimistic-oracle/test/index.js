// Script to test
const Main = require("../index.js");

// Custom winston transport module to monitor winston log outputs
const winston = require("winston");
const sinon = require("sinon");
const { assert } = require("chai");

const hre = require("hardhat");
const { getContract, deployments } = hre;

const { SpyTransport, spyLogLevel, spyLogIncludes, OptimisticOracleType } = require("@uma/financial-templates-lib");

const OptimisticOracle = getContract("OptimisticOracle");
const OptimisticOracleV2 = getContract("OptimisticOracleV2");
const SkinnyOptimisticOracle = getContract("SkinnyOptimisticOracle");
const MockOracle = getContract("MockOracleAncillary");
const Finder = getContract("Finder");
const Timer = getContract("Timer");

describe("index.js", function () {
  let spy;
  let spyLogger;

  let pollingDelay = 0; // 0 polling delay creates a serverless bot that yields after one full execution.
  let errorRetries = 1;
  let errorRetriesTimeout = 0.1; // 100 milliseconds between performing retries

  let optimisticOracle;
  let optimisticOracleV2;
  let skinnyOptimisticOracle;
  let finder;
  let timer;
  let mockOracle;

  before(async function () {
    const accounts = await web3.eth.getAccounts();
    finder = await Finder.new().send({ from: accounts[0] });
    timer = await Timer.new().send({ from: accounts[0] });
    mockOracle = await MockOracle.new(finder.options.address, timer.options.address).send({ from: accounts[0] });

    // Deploy new OptimisticOracles.
    optimisticOracle = await OptimisticOracle.new("120", finder.options.address, timer.options.address).send({
      from: accounts[0],
    });

    optimisticOracleV2 = await OptimisticOracleV2.new("120", finder.options.address, timer.options.address).send({
      from: accounts[0],
    });

    skinnyOptimisticOracle = await SkinnyOptimisticOracle.new(
      "120",
      finder.options.address,
      timer.options.address
    ).send({ from: accounts[0] });

    // Add deployed addresses to hardhat deployments so they are available from `getAddress`.
    deployments.save("OptimisticOracle", { address: optimisticOracle.options.address, abi: OptimisticOracle.abi });
    deployments.save("OptimisticOracleV2", {
      address: optimisticOracleV2.options.address,
      abi: OptimisticOracleV2.abi,
    });
    deployments.save("SkinnyOptimisticOracle", {
      address: skinnyOptimisticOracle.options.address,
      abi: SkinnyOptimisticOracle.abi,
    });
    deployments.save("VotingV2", { address: mockOracle.options.address, abi: MockOracle.abi });
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
    assert.equal(spy.getCall(0).lastArg.oracleType, "VotingV2");
    assert.equal(spy.getCall(0).lastArg.optimisticOracleType, "OptimisticOracle");
    assert.isTrue(spyLogIncludes(spy, spy.callCount - 1, "End of serverless execution loop - terminating process"));
  });
  it("Works with SkinnyOptimisticOracle", async function () {
    // We will create a new spy logger, listening for debug events because success logs are tagged with the
    // debug level.
    spy = sinon.spy();
    spyLogger = winston.createLogger({
      level: "debug",
      transports: [new SpyTransport({ level: "debug" }, { spy: spy })],
    });

    await Main.run({
      logger: spyLogger,
      web3,
      pollingDelay,
      errorRetries,
      errorRetriesTimeout,
      optimisticOracleType: OptimisticOracleType.SkinnyOptimisticOracle,
    });

    for (let i = 0; i < spy.callCount; i++) {
      assert.notStrictEqual(spyLogLevel(spy, i), "error");
    }

    // The first log should indicate that the OO-Proposer runner started successfully
    // and auto detected the OO's deployed address.
    assert.isTrue(spyLogIncludes(spy, 0, "OptimisticOracle proposer started"));
    assert.isTrue(spyLogIncludes(spy, 0, skinnyOptimisticOracle.options.address));
    assert.equal(spy.getCall(0).lastArg.optimisticOracleType, "SkinnyOptimisticOracle");
    assert.isTrue(spyLogIncludes(spy, spy.callCount - 1, "End of serverless execution loop - terminating process"));
  });
  it("Works with OptimisticOracleV2", async function () {
    // We will create a new spy logger, listening for debug events because success logs are tagged with the
    // debug level.
    spy = sinon.spy();
    spyLogger = winston.createLogger({
      level: "debug",
      transports: [new SpyTransport({ level: "debug" }, { spy: spy })],
    });

    await Main.run({
      logger: spyLogger,
      web3,
      pollingDelay,
      errorRetries,
      errorRetriesTimeout,
      optimisticOracleType: OptimisticOracleType.OptimisticOracleV2,
    });

    for (let i = 0; i < spy.callCount; i++) {
      assert.notStrictEqual(spyLogLevel(spy, i), "error");
    }

    // The first log should indicate that the OO-Proposer runner started successfully
    // and auto detected the OO's deployed address.
    assert.isTrue(spyLogIncludes(spy, 0, "OptimisticOracle proposer started"));
    assert.isTrue(spyLogIncludes(spy, 0, optimisticOracleV2.options.address));
    assert.equal(spy.getCall(0).lastArg.optimisticOracleType, "OptimisticOracleV2");
    assert.isTrue(spyLogIncludes(spy, spy.callCount - 1, "End of serverless execution loop - terminating process"));
  });
});
