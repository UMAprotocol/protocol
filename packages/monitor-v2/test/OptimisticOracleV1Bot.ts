import "@nomiclabs/hardhat-ethers";
import { ExpandedERC20Ethers, MockOracleAncillaryEthers, TimerEthers } from "@uma/contracts-node";
import { spyLogIncludes, spyLogLevel, GasEstimator } from "@uma/financial-templates-lib";
import { assert } from "chai";
import { OracleType } from "../src/bot-oo/common";
import { settleRequests } from "../src/bot-oo/SettleRequests";
import { defaultLiveness, defaultOptimisticOracleV2Identifier } from "./constants";
import { optimisticOracleV1Fixture, OptimisticOracleV1Ethers } from "./fixtures/OptimisticOracleV1.Fixture";
import { umaEcosystemFixture } from "./fixtures/UmaEcosystem.Fixture";
import { hre, Signer, toUtf8Bytes, toUtf8String } from "./utils";
import { makeMonitoringParamsOO } from "./helpers/monitoring";
import { makeSpyLogger } from "./helpers/logging";
import { advanceTimerPastLiveness } from "./helpers/time";

const ethers = hre.ethers;

const createParams = (oracleType: OracleType, contractAddress: string) =>
  makeMonitoringParamsOO(oracleType, contractAddress, { settleRequestsEnabled: true });

describe("OptimisticOracleV1Bot", function () {
  let bondToken: ExpandedERC20Ethers;
  let optimisticOracleV1: OptimisticOracleV1Ethers;
  let timer: TimerEthers;
  let requester: Signer;
  let proposer: Signer;
  let disputer: Signer;
  let mockOracle: MockOracleAncillaryEthers;
  let gasEstimator: GasEstimator;

  const ancillaryData = toUtf8Bytes("This is just a test question");

  before(async function () {
    // Create a single GasEstimator for this file using the global provider/chainId
    const { logger } = makeSpyLogger();
    const network = await ethers.provider.getNetwork();
    gasEstimator = new GasEstimator(logger, undefined, network.chainId, ethers.provider);
    await gasEstimator.update();
  });

  beforeEach(async function () {
    [requester, proposer, disputer] = (await ethers.getSigners()) as Signer[];

    const uma = await umaEcosystemFixture();
    timer = uma.timer;
    mockOracle = uma.mockOracle;

    const oov1 = await optimisticOracleV1Fixture();
    bondToken = oov1.bondToken;
    optimisticOracleV1 = oov1.optimisticOracleV1;

    // Fund proposer with bond amount and approve OOV1 to spend bond tokens.
    const bond = ethers.utils.parseEther("1000");
    await bondToken.addMinter(await requester.getAddress());
    await bondToken.mint(await proposer.getAddress(), bond);
    await bondToken.mint(await disputer.getAddress(), bond);
    await bondToken.connect(proposer).approve(optimisticOracleV1.address, bond);
    await bondToken.connect(disputer).approve(optimisticOracleV1.address, bond);
  });

  it("Settle price request happy path", async function () {
    await (
      await optimisticOracleV1.requestPrice(
        defaultOptimisticOracleV2Identifier,
        0,
        ethers.utils.hexlify(ancillaryData),
        bondToken.address,
        0
      )
    ).wait();

    const proposeReceipt = await (
      await optimisticOracleV1
        .connect(proposer)
        .proposePrice(
          await requester.getAddress(),
          defaultOptimisticOracleV2Identifier,
          0,
          ethers.utils.hexlify(ancillaryData),
          ethers.utils.parseEther("1")
        )
    ).wait();

    // Move timer forward to after liveness to allow settlement
    await advanceTimerPastLiveness(timer, proposeReceipt.blockNumber!, defaultLiveness);

    const { spy, logger } = makeSpyLogger();
    const params = await createParams("OptimisticOracle", optimisticOracleV1.address);
    await gasEstimator.update();
    await settleRequests(logger, params, gasEstimator);

    const settledIndex = spy
      .getCalls()
      .findIndex((c) => c.lastArg?.message === "Price Request Settled ✅" && c.lastArg?.at === "OOv1Bot");
    assert.isAbove(settledIndex, -1, "Expected a settlement log to be emitted");
    assert.equal(spy.getCall(settledIndex).lastArg.at, "OOv1Bot");
    assert.equal(spy.getCall(settledIndex).lastArg.message, "Price Request Settled ✅");
    assert.equal(spyLogLevel(spy, settledIndex), "warn");
    assert.isTrue(spyLogIncludes(spy, settledIndex, toUtf8String(ancillaryData)));
    assert.isTrue(spyLogIncludes(spy, settledIndex, "Resolved Price"));
    assert.equal(spy.getCall(settledIndex).lastArg.notificationPath, "optimistic-oracle");

    // Subsequent run should produce no settlement logs (but may have debug logs).
    spy.resetHistory();
    {
      const params2 = await createParams("OptimisticOracle", optimisticOracleV1.address);
      await gasEstimator.update();
      await settleRequests(logger, params2, gasEstimator);
    }

    // Check that no settlement warning logs were generated
    const settlementLogs = spy.getCalls().filter((call) => call.lastArg?.message === "Price Request Settled ✅");
    assert.equal(settlementLogs.length, 0, "No settlement logs should be generated on subsequent runs");
  });

  it("Does not settle before liveness", async function () {
    await (
      await optimisticOracleV1.requestPrice(
        defaultOptimisticOracleV2Identifier,
        0,
        ethers.utils.hexlify(ancillaryData),
        bondToken.address,
        0
      )
    ).wait();

    await (
      await optimisticOracleV1
        .connect(proposer)
        .proposePrice(
          await requester.getAddress(),
          defaultOptimisticOracleV2Identifier,
          0,
          ethers.utils.hexlify(ancillaryData),
          ethers.utils.parseEther("1")
        )
    ).wait();

    const { spy, logger } = makeSpyLogger();
    const params = await createParams("OptimisticOracle", optimisticOracleV1.address);
    await gasEstimator.update();
    await settleRequests(logger, params, gasEstimator);

    // Check that no settlement warning logs were generated (but debug logs are OK).
    const settlementLogs = spy.getCalls().filter((call) => call.lastArg?.message === "Price Request Settled ✅");
    assert.equal(settlementLogs.length, 0, "No settlement logs should be generated before liveness expires");
  });

  it("Settles disputed request once DVM resolved", async function () {
    await (
      await optimisticOracleV1.requestPrice(
        defaultOptimisticOracleV2Identifier,
        0,
        ethers.utils.hexlify(ancillaryData),
        bondToken.address,
        0
      )
    ).wait();

    await (
      await optimisticOracleV1
        .connect(proposer)
        .proposePrice(
          await requester.getAddress(),
          defaultOptimisticOracleV2Identifier,
          0,
          ethers.utils.hexlify(ancillaryData),
          ethers.utils.parseEther("1")
        )
    ).wait();

    await (
      await optimisticOracleV1
        .connect(disputer)
        .disputePrice(
          await requester.getAddress(),
          defaultOptimisticOracleV2Identifier,
          0,
          ethers.utils.hexlify(ancillaryData)
        )
    ).wait();

    // Resolve in DVM via MockOracle
    const pending = await mockOracle.getPendingQueries();
    const last = pending[pending.length - 1]!;
    await (
      await mockOracle.pushPrice(last.identifier, last.time, last.ancillaryData, ethers.utils.parseEther("1"))
    ).wait();

    const { spy, logger } = makeSpyLogger();

    {
      const params2 = await createParams("OptimisticOracle", optimisticOracleV1.address);
      await gasEstimator.update();
      await settleRequests(logger, params2, gasEstimator);
    }

    const settledIndex = spy
      .getCalls()
      .findIndex((c) => c.lastArg?.message === "Price Request Settled ✅" && c.lastArg?.at === "OOv1Bot");
    assert.isAbove(settledIndex, -1, "Expected a settlement log to be emitted");
    assert.equal(spy.getCall(settledIndex).lastArg.at, "OOv1Bot");
    assert.equal(spy.getCall(settledIndex).lastArg.message, "Price Request Settled ✅");
    assert.equal(spyLogLevel(spy, settledIndex), "warn");
    assert.isTrue(spyLogIncludes(spy, settledIndex, toUtf8String(ancillaryData)));
    assert.isTrue(spyLogIncludes(spy, settledIndex, "Resolved Price"));
    assert.equal(spy.getCall(settledIndex).lastArg.notificationPath, "optimistic-oracle");

    // No additional settlement logs on subsequent run
    spy.resetHistory();
    {
      const params3 = await createParams("OptimisticOracle", optimisticOracleV1.address);
      await gasEstimator.update();
      await settleRequests(logger, params3, gasEstimator);
    }
    const settlementLogs = spy.getCalls().filter((call) => call.lastArg?.message === "Price Request Settled ✅");
    assert.equal(settlementLogs.length, 0, "No settlement logs should be generated on subsequent runs");
  });
});
