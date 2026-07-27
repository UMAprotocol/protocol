import "@nomiclabs/hardhat-ethers";
import {
  ExpandedERC20Ethers,
  MockOracleAncillaryEthers,
  OptimisticOracleV2Ethers,
  TimerEthers,
} from "@uma/contracts-node";
import { spyLogIncludes, spyLogLevel, GasEstimator } from "@uma/financial-templates-lib";
import { BlockFinder } from "@uma/sdk";
import { assert } from "chai";
import { OracleType, parseProposalIdList, parseSettleProposalIdLists } from "../src/bot-oo/common";
import { proposalEventId } from "../src/bot-oo/requestKey";
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

const getReceiptBlockNumber = (receipt: { blockNumber?: number }) => {
  if (receipt.blockNumber === undefined) throw new Error("Expected transaction receipt to include blockNumber");
  return receipt.blockNumber;
};

const getLast = <T>(items: T[], message: string) => {
  const item = items[items.length - 1];
  if (item === undefined) throw new Error(message);
  return item;
};

const getProposalEventId = (receipt: { events?: { event?: string; transactionHash: string; logIndex: number }[] }) => {
  const event = receipt.events?.find((e) => e.event === "ProposePrice");
  if (event === undefined) throw new Error("Expected a ProposePrice event in the receipt");
  return proposalEventId(event.transactionHash, event.logIndex);
};

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
    await advanceTimerPastLiveness(timer, getReceiptBlockNumber(proposeReceipt), defaultLiveness);

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

  it("Skips proposals below the minimum proposal age and settles once old enough", async function () {
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

    const minProposalAge = defaultLiveness + 15 * 60;
    const proposalBlock = await ethers.provider.getBlock(getReceiptBlockNumber(proposeReceipt));
    await (await timer.setCurrentTime(proposalBlock.timestamp + minProposalAge - 1)).wait();

    const { spy, logger } = makeSpyLogger();
    const params = await createParams("OptimisticOracleV2", optimisticOracleV2.address);
    params.settleMinProposalAgeSeconds = minProposalAge;
    await gasEstimator.update();
    await settleRequests(logger, params, gasEstimator);

    let settlementLogs = spy.getCalls().filter((call) => call.lastArg?.message === "Price Request Settled ✅");
    assert.equal(settlementLogs.length, 0, "Request should not settle before minimum proposal age");

    spy.resetHistory();
    await (await timer.setCurrentTime(proposalBlock.timestamp + minProposalAge)).wait();
    await gasEstimator.update();
    await settleRequests(logger, params, gasEstimator);

    settlementLogs = spy.getCalls().filter((call) => call.lastArg?.message === "Price Request Settled ✅");
    assert.equal(settlementLogs.length, 1, "Request should settle once minimum proposal age is reached");
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
    const last = getLast(pending, "Expected a pending DVM query");
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

  it("Applies the minimum proposal age gate to disputed requests", async function () {
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

    await (
      await optimisticOracleV2
        .connect(disputer)
        .disputePrice(await requester.getAddress(), defaultOptimisticOracleV2Identifier, 0, ancillaryData)
    ).wait();

    const pending = await mockOracle.getPendingQueries();
    const last = getLast(pending, "Expected a pending DVM query");
    await (
      await mockOracle.pushPrice(last.identifier, last.time, last.ancillaryData, ethers.utils.parseEther("1"))
    ).wait();

    const minProposalAge = defaultLiveness + 15 * 60;
    const proposalBlock = await ethers.provider.getBlock(getReceiptBlockNumber(proposeReceipt));
    await (await timer.setCurrentTime(proposalBlock.timestamp + minProposalAge - 1)).wait();

    const { spy, logger } = makeSpyLogger();
    const params = await createParams("OptimisticOracleV2", optimisticOracleV2.address);
    params.settleMinProposalAgeSeconds = minProposalAge;
    await gasEstimator.update();
    await settleRequests(logger, params, gasEstimator);

    let settlementLogs = spy.getCalls().filter((call) => call.lastArg?.message === "Price Request Settled ✅");
    assert.equal(settlementLogs.length, 0, "Disputed request should not settle before minimum proposal age");

    spy.resetHistory();
    await (await timer.setCurrentTime(proposalBlock.timestamp + minProposalAge)).wait();
    await gasEstimator.update();
    await settleRequests(logger, params, gasEstimator);

    settlementLogs = spy.getCalls().filter((call) => call.lastArg?.message === "Price Request Settled ✅");
    assert.equal(settlementLogs.length, 1, "Disputed request should settle once minimum proposal age is reached");
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
      lastProposeBlock = getReceiptBlockNumber(proposeReceipt);
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

  it("settleOnlyDisputed skips undisputed expired proposals", async function () {
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

    // Move timer past liveness — request is settleable but was never disputed.
    await advanceTimerPastLiveness(timer, getReceiptBlockNumber(proposeReceipt), defaultLiveness);

    const { spy, logger } = makeSpyLogger();
    const params = await makeMonitoringParamsOO("OptimisticOracleV2", optimisticOracleV2.address, {
      settleRequestsEnabled: false,
      settleOnlyDisputed: true,
    });
    await gasEstimator.update();
    await settleRequests(logger, params, gasEstimator);

    const settlementLogs = spy.getCalls().filter((call) => call.lastArg?.message === "Price Request Settled ✅");
    assert.equal(settlementLogs.length, 0, "Undisputed request should not be settled when settleOnlyDisputed is true");
  });

  it("settleOnlyDisputed settles disputed request once DVM resolved", async function () {
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

    // Resolve in DVM via MockOracle.
    const pending = await mockOracle.getPendingQueries();
    const last = getLast(pending, "Expected a pending DVM query");
    await (
      await mockOracle.pushPrice(last.identifier, last.time, last.ancillaryData, ethers.utils.parseEther("1"))
    ).wait();

    const { spy, logger } = makeSpyLogger();
    const params = await makeMonitoringParamsOO("OptimisticOracleV2", optimisticOracleV2.address, {
      settleRequestsEnabled: false,
      settleOnlyDisputed: true,
    });
    params.settleIncludeList = new Set();
    await gasEstimator.update();
    await settleRequests(logger, params, gasEstimator);

    const settlementLogs = spy.getCalls().filter((call) => call.lastArg?.message === "Price Request Settled ✅");
    assert.equal(settlementLogs.length, 0, "Standard OOv2 include lists must still filter resolved disputes");

    spy.resetHistory();
    params.settleIncludeList = undefined;
    await gasEstimator.update();
    await settleRequests(logger, params, gasEstimator);

    const settledIndex = spy
      .getCalls()
      .findIndex((c) => c.lastArg?.message === "Price Request Settled ✅" && c.lastArg?.at === "OOv2Bot");
    assert.isAbove(settledIndex, -1, "Disputed request should be settled when settleOnlyDisputed is true");
  });

  it("Keeps exclude list behavior for standard OOv2", async function () {
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

    await advanceTimerPastLiveness(timer, getReceiptBlockNumber(proposeReceipt), defaultLiveness);

    const { spy, logger } = makeSpyLogger();
    const params = await createParams("OptimisticOracleV2", optimisticOracleV2.address);
    params.settleExcludeList = new Set([getProposalEventId(proposeReceipt)]);
    await gasEstimator.update();
    await settleRequests(logger, params, gasEstimator);

    const settlementLogs = spy.getCalls().filter((call) => call.lastArg?.message === "Price Request Settled ✅");
    assert.equal(settlementLogs.length, 0, "Excluded standard OOv2 proposal should not be settled");

    const filterLog = getLast(
      spy.getCalls().filter((call) => call.lastArg?.message === "Applied include/exclude proposal filter"),
      "Expected standard OOv2 exclude filter log"
    ).lastArg;
    assert.equal(filterLog.mode, "exclude");
    assert.deepEqual(filterLog.skippedIds, [getProposalEventId(proposeReceipt)]);
  });

  for (const listMode of ["empty include", "invalid include"] as const) {
    it(`Managed OOv2 settles disputed requests when using the ${listMode} list`, async function () {
      await (
        await optimisticOracleV2.requestPrice(
          defaultOptimisticOracleV2Identifier,
          0,
          ancillaryData,
          bondToken.address,
          0
        )
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

      const pending = await mockOracle.getPendingQueries();
      const last = getLast(pending, "Expected a pending DVM query");
      await (
        await mockOracle.pushPrice(last.identifier, last.time, last.ancillaryData, ethers.utils.parseEther("1"))
      ).wait();

      const { spy, logger } = makeSpyLogger();
      const params = await createParams("ManagedOptimisticOracleV2", optimisticOracleV2.address);
      if (listMode === "empty include") {
        params.settleIncludeList = new Set();
      } else {
        params.settleIncludeList = new Set([proposalEventId(`0x${"0".repeat(64)}`, 0)]);
      }
      await gasEstimator.update();
      await settleRequests(logger, params, gasEstimator);

      const settlementLogs = spy.getCalls().filter((call) => call.lastArg?.message === "Price Request Settled ✅");
      assert.equal(settlementLogs.length, 1, "Include lists must not block normal disputed settlement");

      if (listMode === "invalid include") {
        assert.isTrue(
          spy.getCalls().some((call) => call.lastArg?.message === "Failed querying included ProposePrice events"),
          "Invalid direct includes should be logged without blocking disputed settlement"
        );
      }
    });
  }

  it("Uses the include list for non-disputed Managed OOv2 proposals", async function () {
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

    await advanceTimerPastLiveness(timer, getReceiptBlockNumber(proposeReceipt), defaultLiveness);

    // An empty include list settles nothing.
    {
      const { spy, logger } = makeSpyLogger();
      const params = await createParams("ManagedOptimisticOracleV2", optimisticOracleV2.address);
      params.settleIncludeList = new Set();
      await gasEstimator.update();
      await settleRequests(logger, params, gasEstimator);

      const settlementLogs = spy.getCalls().filter((call) => call.lastArg?.message === "Price Request Settled ✅");
      assert.equal(settlementLogs.length, 0, "Proposal absent from the include list should not be settled");

      const skipLog = getLast(
        spy
          .getCalls()
          .filter(
            (call) =>
              call.lastArg?.message === "Skipping non-resolved Managed OOv2 request outside settlement include list"
          ),
        "Expected include list skip log"
      ).lastArg;
      assert.equal(skipLog.proposalEventId, getProposalEventId(proposeReceipt));
    }

    // An include list containing the proposal: it settles.
    {
      const { spy, logger } = makeSpyLogger();
      const params = await createParams("ManagedOptimisticOracleV2", optimisticOracleV2.address);
      params.settleIncludeList = new Set([getProposalEventId(proposeReceipt)]);
      params.botModes.settleOnlyDisputed = true;
      // Exclude the proposal from the historical event range to exercise the direct include-list lookup.
      params.timeLookback = 0;
      params.blockFinder = new BlockFinder(params.provider.getBlock.bind(params.provider), undefined, params.chainId);
      await gasEstimator.update();
      await settleRequests(logger, params, gasEstimator);

      const settlementLogs = spy.getCalls().filter((call) => call.lastArg?.message === "Price Request Settled ✅");
      assert.equal(settlementLogs.length, 1, "Proposal present in the include list should be settled");
    }
  });

  it("Parses explicit empty proposal lists", async function () {
    const includeList = parseProposalIdList("[]", "SETTLE_INCLUDE_LIST");
    assert.instanceOf(includeList, Set);
    assert.equal(includeList?.size, 0);

    const excludeList = parseProposalIdList("[]", "SETTLE_EXCLUDE_LIST");
    assert.instanceOf(excludeList, Set);
    assert.equal(excludeList?.size, 0);
  });

  it("Defaults Managed OOv2 settlements to an empty include list", async function () {
    const { settleIncludeList, settleExcludeList } = parseSettleProposalIdLists(
      {} as NodeJS.ProcessEnv,
      "ManagedOptimisticOracleV2"
    );
    assert.instanceOf(settleIncludeList, Set);
    assert.equal(settleIncludeList?.size, 0);
    assert.isUndefined(settleExcludeList);

    const standardOOv2 = parseSettleProposalIdLists({} as NodeJS.ProcessEnv, "OptimisticOracleV2");
    assert.isUndefined(standardOOv2.settleIncludeList);
    assert.isUndefined(standardOOv2.settleExcludeList);
  });

  it("Rejects exclude lists for Managed OOv2", async function () {
    for (const value of ["", "[]", JSON.stringify([`0x${"0".repeat(64)}:0`])]) {
      assert.throws(
        () =>
          parseSettleProposalIdLists({ SETTLE_EXCLUDE_LIST: value } as NodeJS.ProcessEnv, "ManagedOptimisticOracleV2"),
        /SETTLE_EXCLUDE_LIST is not supported for ManagedOptimisticOracleV2/
      );
    }

    const { logger } = makeSpyLogger();
    const params = await createParams("ManagedOptimisticOracleV2", optimisticOracleV2.address);
    params.settleExcludeList = new Set();

    let error: unknown;
    try {
      await settleRequests(logger, params, gasEstimator);
    } catch (err) {
      error = err;
    }

    assert.instanceOf(error, Error);
    assert.match((error as Error).message, /SETTLE_EXCLUDE_LIST is not supported for ManagedOptimisticOracleV2/);
  });

  it("Rejects Managed OOv2 settlement params without an include list", async function () {
    const { logger } = makeSpyLogger();
    const params = await createParams("ManagedOptimisticOracleV2", optimisticOracleV2.address);
    params.settleIncludeList = undefined;

    let error: unknown;
    try {
      await settleRequests(logger, params, gasEstimator);
    } catch (err) {
      error = err;
    }

    assert.instanceOf(error, Error);
    assert.match((error as Error).message, /Managed OOv2 settlement requires an include list/);
  });

  it("Rejects include/exclude lists for non-OOv2 oracle types", async function () {
    // Only the OOv2 settler applies these lists; silently ignoring them would settle proposals the operator
    // intended to skip, so startup must fail instead.
    const env = { SETTLE_EXCLUDE_LIST: JSON.stringify([`0x${"0".repeat(64)}:0`]) } as NodeJS.ProcessEnv;
    assert.throws(
      () => parseSettleProposalIdLists(env, "OptimisticOracle"),
      /only supported for OptimisticOracleV2 and ManagedOptimisticOracleV2/
    );
    assert.throws(
      () => parseSettleProposalIdLists(env, "SkinnyOptimisticOracle"),
      /only supported for OptimisticOracleV2 and ManagedOptimisticOracleV2/
    );
    assert.doesNotThrow(() => parseSettleProposalIdLists(env, "OptimisticOracleV2"));

    // An empty exclude list skips nothing and behaves the same as unset, so it must not block startup.
    const emptyExcludeEnv = { SETTLE_EXCLUDE_LIST: "[]" } as NodeJS.ProcessEnv;
    assert.doesNotThrow(() => parseSettleProposalIdLists(emptyExcludeEnv, "OptimisticOracle"));

    // An empty include list means "settle nothing", which non-OOv2 cannot honor, so it must still throw.
    const emptyIncludeEnv = { SETTLE_INCLUDE_LIST: "[]" } as NodeJS.ProcessEnv;
    assert.throws(
      () => parseSettleProposalIdLists(emptyIncludeEnv, "OptimisticOracle"),
      /only supported for OptimisticOracleV2 and ManagedOptimisticOracleV2/
    );
  });
});
