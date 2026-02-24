import "@nomiclabs/hardhat-ethers";
import {
  ExpandedERC20Ethers,
  MockOracleAncillaryEthers,
  OptimisticOracleV2Ethers,
  TimerEthers,
} from "@uma/contracts-node";
import { spyLogIncludes, spyLogLevel, GasEstimator } from "@uma/financial-templates-lib";
import { assert } from "chai";
import { OracleType } from "../src/bot-oo/common";
import { settleRequests } from "../src/bot-oo/SettleRequests";
import { defaultLiveness, defaultOptimisticOracleV2Identifier } from "./constants";
import { optimisticOracleV2Fixture } from "./fixtures/OptimisticOracleV2.Fixture";
import { umaEcosystemFixture } from "./fixtures/UmaEcosystem.Fixture";
import { hre, Signer, toUtf8Bytes, toUtf8String } from "./utils";
import { makeMonitoringParamsOO } from "./helpers/monitoring";
import { makeSpyLogger } from "./helpers/logging";
import { advanceTimerPastLiveness } from "./helpers/time";
import { addGlobalHardhatTestingAddress } from "@uma/common";
import { defaultCurrency } from "./constants";
import { getContractFactory } from "./utils";

const ethers = hre.ethers;

const createParams = (oracleType: OracleType, contractAddress: string) =>
  makeMonitoringParamsOO(oracleType, contractAddress, { settleRequestsEnabled: false });

describe("OptimisticOracleV2Bot", function () {
  let bondToken: ExpandedERC20Ethers;
  let optimisticOracleV2: OptimisticOracleV2Ethers;
  let timer: TimerEthers;
  let requester: Signer;
  let proposer: Signer;
  let disputer: Signer;
  let mockOracle: MockOracleAncillaryEthers;
  let gasEstimator: GasEstimator;

  const ancillaryData = toUtf8Bytes("This is just a test question");

  beforeEach(async function () {
    [requester, proposer, disputer] = (await ethers.getSigners()) as Signer[];

    const uma = await umaEcosystemFixture();
    timer = uma.timer;
    mockOracle = uma.mockOracle;

    const oov2 = await optimisticOracleV2Fixture();
    bondToken = oov2.bondToken;
    optimisticOracleV2 = oov2.optimisticOracleV2;

    // Fund proposer with bond amount and approve OOV2 to spend bond tokens.
    const bond = ethers.utils.parseEther("1000");
    await bondToken.addMinter(await requester.getAddress());
    await bondToken.mint(await proposer.getAddress(), bond);
    await bondToken.mint(await disputer.getAddress(), bond);
    await bondToken.connect(proposer).approve(optimisticOracleV2.address, bond);
    await bondToken.connect(disputer).approve(optimisticOracleV2.address, bond);
  });

  before(async function () {
    const { logger } = makeSpyLogger();
    const network = await ethers.provider.getNetwork();
    gasEstimator = new GasEstimator(logger, undefined, network.chainId, ethers.provider);
    await gasEstimator.update();
  });

  it("Settle price request happy path", async function () {
    await (
      await optimisticOracleV2.requestPrice(defaultOptimisticOracleV2Identifier, 0, ancillaryData, bondToken.address, 0)
    ).wait();

    const proposeReceipt = await (
      await optimisticOracleV2
        .connect(proposer)
        .proposePrice(
          await requester.getAddress(),
          defaultOptimisticOracleV2Identifier,
          0,
          ancillaryData,
          ethers.utils.parseEther("1")
        )
    ).wait();

    // Move timer forward to after liveness to allow settlement
    await advanceTimerPastLiveness(timer, proposeReceipt.blockNumber!, defaultLiveness);

    const { spy, logger } = makeSpyLogger();
    const params = await createParams("OptimisticOracleV2", optimisticOracleV2.address);
    await gasEstimator.update();
    await settleRequests(logger, params, gasEstimator);

    const settledIndex = spy
      .getCalls()
      .findIndex((c) => c.lastArg?.message === "Price Request Settled ✅" && c.lastArg?.at === "OOv2Bot");
    assert.isAbove(settledIndex, -1, "Expected a settlement log to be emitted");
    assert.equal(spy.getCall(settledIndex).lastArg.at, "OOv2Bot");
    assert.equal(spy.getCall(settledIndex).lastArg.message, "Price Request Settled ✅");
    assert.equal(spyLogLevel(spy, settledIndex), "warn");
    assert.isTrue(spyLogIncludes(spy, settledIndex, toUtf8String(ancillaryData)));
    assert.isTrue(spyLogIncludes(spy, settledIndex, "Resolved Price"));
    assert.equal(spy.getCall(settledIndex).lastArg.notificationPath, "optimistic-oracle");

    // Subsequent run should produce no settlement logs (but may have debug logs).
    spy.resetHistory();
    {
      const params2 = await createParams("OptimisticOracleV2", optimisticOracleV2.address);
      await gasEstimator.update();
      await settleRequests(logger, params2, gasEstimator);
    }

    // Check that no settlement warning logs were generated
    const settlementLogs = spy.getCalls().filter((call) => call.lastArg?.message === "Price Request Settled ✅");
    assert.equal(settlementLogs.length, 0, "No settlement logs should be generated on subsequent runs");
  });

  it("Does not settle before liveness", async function () {
    await (
      await optimisticOracleV2.requestPrice(defaultOptimisticOracleV2Identifier, 0, ancillaryData, bondToken.address, 0)
    ).wait();

    await (
      await optimisticOracleV2
        .connect(proposer)
        .proposePrice(
          await requester.getAddress(),
          defaultOptimisticOracleV2Identifier,
          0,
          ancillaryData,
          ethers.utils.parseEther("1")
        )
    ).wait();

    const { spy, logger } = makeSpyLogger();
    const params = await createParams("OptimisticOracleV2", optimisticOracleV2.address);
    await gasEstimator.update();
    await settleRequests(logger, params, gasEstimator);

    // Check that no settlement warning logs were generated (but debug logs are OK).
    const settlementLogs = spy.getCalls().filter((call) => call.lastArg?.message === "Price Request Settled ✅");
    assert.equal(settlementLogs.length, 0, "No settlement logs should be generated before liveness expires");
  });

  it("Settles disputed request once DVM resolved", async function () {
    await (
      await optimisticOracleV2.requestPrice(defaultOptimisticOracleV2Identifier, 0, ancillaryData, bondToken.address, 0)
    ).wait();

    await (
      await optimisticOracleV2
        .connect(proposer)
        .proposePrice(
          await requester.getAddress(),
          defaultOptimisticOracleV2Identifier,
          0,
          ancillaryData,
          ethers.utils.parseEther("1")
        )
    ).wait();

    await (
      await optimisticOracleV2
        .connect(disputer)
        .disputePrice(await requester.getAddress(), defaultOptimisticOracleV2Identifier, 0, ancillaryData)
    ).wait();

    // Resolve in DVM via MockOracle
    const pending = await mockOracle.getPendingQueries();
    const last = pending[pending.length - 1]!;
    await (
      await mockOracle.pushPrice(last.identifier, last.time, last.ancillaryData, ethers.utils.parseEther("1"))
    ).wait();

    const { spy, logger } = makeSpyLogger();
    const params = await createParams("OptimisticOracleV2", optimisticOracleV2.address);
    await gasEstimator.update();
    await settleRequests(logger, params, gasEstimator);

    const settledIndex = spy
      .getCalls()
      .findIndex((c) => c.lastArg?.message === "Price Request Settled ✅" && c.lastArg?.at === "OOv2Bot");
    assert.isAbove(settledIndex, -1, "Expected a settlement log to be emitted");
    assert.equal(spy.getCall(settledIndex).lastArg.at, "OOv2Bot");
    assert.equal(spy.getCall(settledIndex).lastArg.message, "Price Request Settled ✅");
    assert.equal(spyLogLevel(spy, settledIndex), "warn");
    assert.isTrue(spyLogIncludes(spy, settledIndex, toUtf8String(ancillaryData)));
    assert.isTrue(spyLogIncludes(spy, settledIndex, "Resolved Price"));
    assert.equal(spy.getCall(settledIndex).lastArg.notificationPath, "optimistic-oracle");

    // No additional settlement logs on subsequent run
    spy.resetHistory();
    {
      const params2 = await createParams("OptimisticOracleV2", optimisticOracleV2.address);
      await gasEstimator.update();
      await settleRequests(logger, params2, gasEstimator);
    }
    const settlementLogs = spy.getCalls().filter((call) => call.lastArg?.message === "Price Request Settled ✅");
    assert.equal(settlementLogs.length, 0, "No settlement logs should be generated on subsequent runs");
  });

  it("Settles multiple requests in a single multicall batch", async function () {
    // Deploy an OOv2 with MultiCaller (mimics ManagedOptimisticOracleV2).
    const [deployer] = (await ethers.getSigners()) as Signer[];
    const uma = await umaEcosystemFixture();

    const mcBondToken = (await (await getContractFactory("ExpandedERC20", deployer)).deploy(
      defaultCurrency.name,
      defaultCurrency.symbol,
      defaultCurrency.decimals
    )) as ExpandedERC20Ethers;
    await uma.collateralWhitelist.addToWhitelist(mcBondToken.address);
    await uma.store.setFinalFee(mcBondToken.address, { rawValue: defaultCurrency.finalFee });
    await uma.identifierWhitelist.addSupportedIdentifier(defaultOptimisticOracleV2Identifier);

    // Deploy the combined OOv2+MultiCaller contract via hardhat compilation.
    const oov2McFactory = await ethers.getContractFactory("OptimisticOracleV2Multicaller", deployer);
    const oov2Mc = (await oov2McFactory.deploy(
      defaultLiveness,
      uma.finder.address,
      uma.timer.address
    )) as OptimisticOracleV2Ethers;
    addGlobalHardhatTestingAddress("OptimisticOracleV2", oov2Mc.address);

    // Mint bonds and approve.
    const bond = ethers.utils.parseEther("5000");
    await mcBondToken.addMinter(await deployer.getAddress());
    await mcBondToken.mint(await deployer.getAddress(), bond);
    await mcBondToken.approve(oov2Mc.address, bond);

    // Create 3 requests with different ancillary data.
    const ancillaryDataItems = [
      toUtf8Bytes("Multicall question 1"),
      toUtf8Bytes("Multicall question 2"),
      toUtf8Bytes("Multicall question 3"),
    ];

    let lastProposeBlock = 0;
    for (const data of ancillaryDataItems) {
      await (await oov2Mc.requestPrice(defaultOptimisticOracleV2Identifier, 0, data, mcBondToken.address, 0)).wait();
      const proposeReceipt = await (
        await oov2Mc.proposePrice(
          await deployer.getAddress(),
          defaultOptimisticOracleV2Identifier,
          0,
          data,
          ethers.utils.parseEther("1")
        )
      ).wait();
      lastProposeBlock = proposeReceipt.blockNumber!;
    }

    // Move timer past liveness for all proposals.
    await advanceTimerPastLiveness(uma.timer, lastProposeBlock, defaultLiveness);

    const { spy, logger } = makeSpyLogger();
    const params = await makeMonitoringParamsOO("OptimisticOracleV2", oov2Mc.address, {
      settleRequestsEnabled: false,
    });
    params.settleBatchSize = 10; // Larger than 3, so all go in one batch.

    await gasEstimator.update();
    await settleRequests(logger, params, gasEstimator);

    // Verify all 3 requests were settled and each was logged individually.
    const settleLogs = spy.getCalls().filter((c) => c.lastArg?.message === "Price Request Settled ✅");
    assert.equal(settleLogs.length, 3, "Expected 3 settlement logs");

    // All 3 settlements should share the same tx hash (single multicall transaction).
    // The tx hash is embedded in the mrkdwn field via createEtherscanLinkMarkdown.
    const txHashes = settleLogs.map((c) => {
      const mrkdwn: string = c.lastArg.mrkdwn;
      // Extract tx hash - it appears after "settled in transaction " in the mrkdwn.
      const match = mrkdwn.match(/0x[a-fA-F0-9]{64}/);
      return match ? match[0] : null;
    });
    assert.isNotNull(txHashes[0], "Expected to find tx hash in log");
    assert.equal(txHashes[0], txHashes[1], "All settlements should be in the same tx");
    assert.equal(txHashes[1], txHashes[2], "All settlements should be in the same tx");

    // Verify each ancillary data appears in the logs.
    for (const data of ancillaryDataItems) {
      const dataStr = toUtf8String(data);
      const found = settleLogs.some((c) => c.lastArg.mrkdwn.includes(dataStr));
      assert.isTrue(found, `Expected settlement log to include ancillary data: ${dataStr}`);
    }

    // Subsequent run should produce no settlement logs.
    spy.resetHistory();
    {
      const params2 = await makeMonitoringParamsOO("OptimisticOracleV2", oov2Mc.address, {
        settleRequestsEnabled: false,
      });
      params2.settleBatchSize = 10;
      await gasEstimator.update();
      await settleRequests(logger, params2, gasEstimator);
    }
    const subsequentLogs = spy.getCalls().filter((call) => call.lastArg?.message === "Price Request Settled ✅");
    assert.equal(subsequentLogs.length, 0, "No settlement logs should be generated on subsequent runs");
  });
});
