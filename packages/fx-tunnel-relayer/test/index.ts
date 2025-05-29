import winston from "winston";
import { assert } from "chai";
import { Contract } from "web3-eth-contract";
import sinon from "sinon";
import { run } from "../src/index";
import { interfaceName, ZERO_ADDRESS, RegistryRolesEnum } from "@uma/common";

import { SpyTransport } from "@uma/financial-templates-lib";
import { getAbi } from "@uma/contracts-node";
import { PHASE_LENGTH_SECONDS, SKIP_THRESHOLD_SECONDS } from "../src/constants";

const { getContract, deployments, web3 } = require("hardhat");

const { utf8ToHex } = web3.utils;
const Finder = getContract("Finder");
const OracleChildTunnel = getContract("OracleChildTunnel");
const Registry = getContract("Registry");
const OracleRootTunnel = getContract("OracleRootTunnelMock");
const MockOracle = getContract("MockOracleAncillary");
const StateSync = getContract("StateSyncMock");
const FxChild = getContract("FxChildMock");
const FxRoot = getContract("FxRootMock");

let spyLogger: any;
let spy: any;
let systemSuperUser: string;
let checkpointManager: string;
let owner: any;
let originalEnv: any;

// Contracts
let finder: any;
let oracleChild: Contract;
let oracleRoot: Contract;
let registry: any;
let mockOracle: any;
let stateSync: any;
let fxRoot: any;
let fxChild: any;

describe("index.ts", function () {
  let clock: sinon.SinonFakeTimers;
  after(async function () {
    process.env = originalEnv;
  });
  afterEach(function () {
    if (clock) {
      clock.restore();
    }
  });
  before(async function () {
    [owner, systemSuperUser, checkpointManager] = await web3.eth.getAccounts();
    originalEnv = process.env;

    // Note: We deploy all contracts on local hardhat network to make testing more convenient.

    // Set up mocked Fx tunnel:
    stateSync = await StateSync.new().send({ from: owner });
    fxRoot = await FxRoot.new(stateSync.options.address).send({ from: owner });
    fxChild = await FxChild.new(systemSuperUser).send({ from: owner });
    await fxChild.methods.setFxRoot(fxRoot.options.address).send({ from: owner });
    await fxRoot.methods.setFxChild(fxChild.options.address).send({ from: owner });

    // Set up mocked Oracle infrastructure
    finder = await Finder.new().send({ from: owner });
    mockOracle = await MockOracle.new(finder.options.address, ZERO_ADDRESS).send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.options.address)
      .send({ from: owner });
    registry = await Registry.new().send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Registry), registry.options.address)
      .send({ from: owner });
    await registry.methods.addMember(RegistryRolesEnum.CONTRACT_CREATOR, owner).send({ from: owner });
    await registry.methods.registerContract([], owner).send({ from: owner });
  });
  beforeEach(async function () {
    // Deploy new tunnel contracts so that event logs are fresh for each test
    oracleChild = await OracleChildTunnel.new(fxChild.options.address, finder.options.address).send({ from: owner });
    oracleRoot = await OracleRootTunnel.new(checkpointManager, fxRoot.options.address, finder.options.address).send({
      from: owner,
    });
    await oracleChild.methods.setFxRootTunnel(oracleRoot.options.address).send({ from: owner });
    await oracleRoot.methods.setFxChildTunnel(oracleChild.options.address).send({ from: owner });

    // Save to hre.deployments so that client can fetch contract addresses via getAddress.
    deployments.save("OracleChildTunnel", { address: oracleChild.options.address, abi: getAbi("OracleChildTunnel") });
    deployments.save("OracleRootTunnel", { address: oracleChild.options.address, abi: getAbi("OracleRootTunnel") });

    spy = sinon.spy();
    spyLogger = winston.createLogger({
      level: "debug",
      transports: [new SpyTransport({ level: "debug" }, { spy: spy })],
    });
  });

  it("Runs with no errors", async function () {
    process.env.POLLING_DELAY = "0";
    process.env.CHAIN_ID = ""; // Leave empty so Relayer uses hardhat network web3

    // Must not throw.
    await run(spyLogger, web3);
    assert.isTrue(
      spy.getCall(-2).lastArg.message.includes("No MessageSent events emitted by OracleChildTunnel, exiting")
    );
  });

  it("skips relay when too close to round end", async function () {
    // Arrange: pick a fake “now” that is just 1_000s before the end of a phase
    // Phase length is PHASE_LENGTH_SECONDS. We can pretend we're in the 2nd phase,
    // so round end is at (roundIndex+1)*PHASE_LENGTH_SECONDS = 3*PHASE_LENGTH_SECONDS.
    // We want now = 3*PHASE_LENGTH_SECONDS - 1_000.
    const fakeNowMs = (3 * PHASE_LENGTH_SECONDS - 1_000) * 1_000;
    clock = sinon.useFakeTimers({
      now: fakeNowMs,
      toFake: ["Date"],
    });

    // Use a threshold of 2_000s so that 1_000 < 2_000 → isTooCloseToRoundEnd = true
    process.env.SKIP_THRESHOLD_SECONDS = "2000";
    process.env.POLLING_DELAY = "0";

    // Act
    await run(spyLogger, web3);

    // Assert: our logger spy should have seen the “Skipping relay…” debug
    assert.isTrue(
      spy.calledWithMatch(
        sinon.match({
          message: sinon.match(/Skipping relay: only \d+s left/),
        })
      ),
      "Expected run() to short-circuit with a skip-relay debug message"
    );
  });

  it("Runs when time remaining exceeds threshold", async function () {
    // Arrange: make “now” so that timeRemaining = SKIP_THRESHOLD_SECONDS + 1000
    const fakeNowMs =
      (2 * PHASE_LENGTH_SECONDS - // pretend we’re in the 2nd phase
        (SKIP_THRESHOLD_SECONDS + 1000)) *
      1000;
    clock = sinon.useFakeTimers({
      now: fakeNowMs,
      toFake: ["Date"],
    });

    process.env.POLLING_DELAY = "0";
    process.env.CHAIN_ID = "";

    // Act: should not short-circuit on the “too close” check
    await run(spyLogger, web3);

    // Assert: we hit the “no messages” log from the normal run path
    assert.isTrue(
      spy.getCall(-2).lastArg.message.includes("No MessageSent events emitted by OracleChildTunnel, exiting"),
      "Expected run() to proceed past the skip check and report no messages"
    );
  });
});
