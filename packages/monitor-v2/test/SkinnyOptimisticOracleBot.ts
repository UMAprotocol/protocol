import "@nomiclabs/hardhat-ethers";
import { ExpandedERC20Ethers, MockOracleAncillaryEthers, TimerEthers } from "@uma/contracts-node";
import { spyLogIncludes, spyLogLevel, GasEstimator } from "@uma/financial-templates-lib";
import { assert } from "chai";
import { OracleType } from "../src/bot-oo/common";
import { settleRequests } from "../src/bot-oo/SettleRequests";
import { defaultLiveness, defaultOptimisticOracleV2Identifier } from "./constants";
import { skinnyOptimisticOracleFixture, SkinnyOptimisticOracleEthers } from "./fixtures/SkinnyOptimisticOracle.Fixture";
import { umaEcosystemFixture } from "./fixtures/UmaEcosystem.Fixture";
import { hre, Signer, toUtf8Bytes, toUtf8String } from "./utils";
import { makeMonitoringParamsOO } from "./helpers/monitoring";
import { makeSpyLogger } from "./helpers/logging";
import { advanceTimerPastLiveness } from "./helpers/time";

const ethers = hre.ethers;

const createParams = (oracleType: OracleType, contractAddress: string) =>
  makeMonitoringParamsOO(oracleType, contractAddress, { settleRequestsEnabled: true });

describe("SkinnyOptimisticOracleBot", function () {
  let bondToken: ExpandedERC20Ethers;
  let skinnyOptimisticOracle: SkinnyOptimisticOracleEthers;
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

    const skinnyOO = await skinnyOptimisticOracleFixture();
    bondToken = skinnyOO.bondToken;
    skinnyOptimisticOracle = skinnyOO.skinnyOptimisticOracle;

    // Fund proposer with bond amount and approve Skinny OO to spend bond tokens.
    const bond = ethers.utils.parseEther("1000");
    await bondToken.addMinter(await requester.getAddress());
    await bondToken.mint(await proposer.getAddress(), bond);
    await bondToken.mint(await disputer.getAddress(), bond);
    await bondToken.connect(proposer).approve(skinnyOptimisticOracle.address, bond);
    await bondToken.connect(disputer).approve(skinnyOptimisticOracle.address, bond);
  });

  before(async function () {
    const { logger } = makeSpyLogger();
    const network = await ethers.provider.getNetwork();
    gasEstimator = new GasEstimator(logger, undefined, network.chainId, ethers.provider);
    await gasEstimator.update();
  });

  it("Settle price request happy path", async function () {
    // SkinnyOptimisticOracle uses 32-bit timestamps - use blockchain time
    const timestamp = (await timer.getCurrentTime()).toNumber();

    // Request price with custom parameters
    await (
      await skinnyOptimisticOracle.requestPrice(
        defaultOptimisticOracleV2Identifier,
        timestamp,
        ethers.utils.hexlify(ancillaryData),
        bondToken.address,
        ethers.constants.Zero, // reward
        ethers.utils.parseEther("100"), // bond
        defaultLiveness // customLiveness
      )
    ).wait();

    // Create the request struct to match what the settlement logic expects
    const request = {
      proposer: ethers.constants.AddressZero,
      disputer: ethers.constants.AddressZero,
      currency: bondToken.address,
      settled: false,
      proposedPrice: ethers.constants.Zero,
      resolvedPrice: ethers.constants.Zero,
      expirationTime: ethers.constants.Zero,
      reward: ethers.constants.Zero,
      finalFee: ethers.utils.parseEther("100"),
      bond: ethers.utils.parseEther("100"),
      customLiveness: ethers.BigNumber.from(defaultLiveness), // Match reconstructRequest function
    };

    const proposeReceipt = await (
      await skinnyOptimisticOracle
        .connect(proposer)
        .proposePrice(
          await requester.getAddress(),
          defaultOptimisticOracleV2Identifier,
          timestamp,
          ethers.utils.hexlify(ancillaryData),
          request,
          ethers.utils.parseEther("1")
        )
    ).wait();

    // Move timer forward to after liveness to allow settlement
    await advanceTimerPastLiveness(timer, proposeReceipt.blockNumber!, defaultLiveness);

    const { spy, logger } = makeSpyLogger();
    const params = await createParams("SkinnyOptimisticOracle", skinnyOptimisticOracle.address);
    await gasEstimator.update();
    await settleRequests(logger, params, gasEstimator);

    const settledIndex = spy
      .getCalls()
      .findIndex((c) => c.lastArg?.message === "Price Request Settled ✅" && c.lastArg?.at === "SkinnyOOBot");
    assert.isAbove(settledIndex, -1, "Expected a settlement log to be emitted");
    assert.equal(spy.getCall(settledIndex).lastArg.at, "SkinnyOOBot");
    assert.equal(spy.getCall(settledIndex).lastArg.message, "Price Request Settled ✅");
    assert.equal(spyLogLevel(spy, settledIndex), "warn");
    assert.isTrue(spyLogIncludes(spy, settledIndex, toUtf8String(ancillaryData)));
    assert.isTrue(spyLogIncludes(spy, settledIndex, "Resolved Price"));
    assert.equal(spy.getCall(settledIndex).lastArg.notificationPath, "optimistic-oracle");

    // Subsequent run should produce no settlement logs (but may have debug logs).
    spy.resetHistory();
    await settleRequests(
      logger,
      await createParams("SkinnyOptimisticOracle", skinnyOptimisticOracle.address),
      new GasEstimator(logger)
    );

    // Check that no settlement warning logs were generated
    const settlementLogs = spy.getCalls().filter((call) => call.lastArg?.message === "Price Request Settled ✅");
    assert.equal(settlementLogs.length, 0, "No settlement logs should be generated on subsequent runs");
  });

  it("Does not settle before liveness", async function () {
    // SkinnyOptimisticOracle uses 32-bit timestamps - use blockchain time
    const timestamp = (await timer.getCurrentTime()).toNumber();

    await (
      await skinnyOptimisticOracle.requestPrice(
        defaultOptimisticOracleV2Identifier,
        timestamp,
        ethers.utils.hexlify(ancillaryData),
        bondToken.address,
        ethers.constants.Zero,
        ethers.utils.parseEther("100"),
        defaultLiveness
      )
    ).wait();

    const request = {
      proposer: ethers.constants.AddressZero,
      disputer: ethers.constants.AddressZero,
      currency: bondToken.address,
      settled: false,
      proposedPrice: ethers.constants.Zero,
      resolvedPrice: ethers.constants.Zero,
      expirationTime: ethers.constants.Zero,
      reward: ethers.constants.Zero,
      finalFee: ethers.utils.parseEther("100"),
      bond: ethers.utils.parseEther("100"),
      customLiveness: ethers.BigNumber.from(defaultLiveness),
    };

    await (
      await skinnyOptimisticOracle
        .connect(proposer)
        .proposePrice(
          await requester.getAddress(),
          defaultOptimisticOracleV2Identifier,
          timestamp,
          ethers.utils.hexlify(ancillaryData),
          request,
          ethers.utils.parseEther("1")
        )
    ).wait();

    const { spy, logger } = makeSpyLogger();
    const params = await createParams("SkinnyOptimisticOracle", skinnyOptimisticOracle.address);
    await gasEstimator.update();
    await settleRequests(logger, params, gasEstimator);

    // Check that no settlement warning logs were generated (but debug logs are OK).
    const settlementLogs = spy.getCalls().filter((call) => call.lastArg?.message === "Price Request Settled ✅");
    assert.equal(settlementLogs.length, 0, "No settlement logs should be generated before liveness expires");
  });

  it("Settles disputed request once DVM resolved", async function () {
    const timestamp = (await timer.getCurrentTime()).toNumber();

    await (
      await skinnyOptimisticOracle.requestPrice(
        defaultOptimisticOracleV2Identifier,
        timestamp,
        ethers.utils.hexlify(ancillaryData),
        bondToken.address,
        ethers.constants.Zero,
        ethers.utils.parseEther("100"),
        defaultLiveness
      )
    ).wait();

    const baseRequest = {
      proposer: ethers.constants.AddressZero,
      disputer: ethers.constants.AddressZero,
      currency: bondToken.address,
      settled: false,
      proposedPrice: ethers.constants.Zero,
      resolvedPrice: ethers.constants.Zero,
      expirationTime: ethers.constants.Zero,
      reward: ethers.constants.Zero,
      finalFee: ethers.utils.parseEther("100"),
      bond: ethers.utils.parseEther("100"),
      customLiveness: ethers.BigNumber.from(defaultLiveness),
    };

    await (
      await skinnyOptimisticOracle
        .connect(proposer)
        .proposePrice(
          await requester.getAddress(),
          defaultOptimisticOracleV2Identifier,
          timestamp,
          ethers.utils.hexlify(ancillaryData),
          baseRequest,
          ethers.utils.parseEther("1")
        )
    ).wait();

    // Fetch the request struct from the ProposePrice event to pass into dispute
    const proposeEvents = await skinnyOptimisticOracle.queryFilter(skinnyOptimisticOracle.filters.ProposePrice());
    const latestPropose = proposeEvents[proposeEvents.length - 1]!;
    const proposedRequest = latestPropose.args!.request;

    await (
      await skinnyOptimisticOracle
        .connect(disputer)
        .disputePrice(
          await requester.getAddress(),
          defaultOptimisticOracleV2Identifier,
          timestamp,
          ethers.utils.hexlify(ancillaryData),
          proposedRequest
        )
    ).wait();

    // Simulate VotingV2 resolution by pushing the price in MockOracle
    const pending = await mockOracle.getPendingQueries();
    const last = pending[pending.length - 1]!;
    await (
      await mockOracle.pushPrice(last.identifier, last.time, last.ancillaryData, ethers.utils.parseEther("1"))
    ).wait();

    const { spy, logger } = makeSpyLogger();
    const params = await createParams("SkinnyOptimisticOracle", skinnyOptimisticOracle.address);
    await gasEstimator.update();
    await settleRequests(logger, params, gasEstimator);

    const settledIndex = spy
      .getCalls()
      .findIndex((c) => c.lastArg?.message === "Price Request Settled ✅" && c.lastArg?.at === "SkinnyOOBot");
    assert.isAbove(settledIndex, -1, "Expected a settlement log to be emitted");
    assert.equal(spy.getCall(settledIndex).lastArg.at, "SkinnyOOBot");
    assert.equal(spy.getCall(settledIndex).lastArg.message, "Price Request Settled ✅");
    assert.equal(spyLogLevel(spy, settledIndex), "warn");
    assert.isTrue(spyLogIncludes(spy, settledIndex, toUtf8String(ancillaryData)));
    assert.isTrue(spyLogIncludes(spy, settledIndex, "Resolved Price"));
    assert.equal(spy.getCall(settledIndex).lastArg.notificationPath, "optimistic-oracle");

    // No additional settlement logs on subsequent run
    spy.resetHistory();
    {
      const params2 = await createParams("SkinnyOptimisticOracle", skinnyOptimisticOracle.address);
      await gasEstimator.update();
      await settleRequests(logger, params2, gasEstimator);
    }
    const settlementLogs = spy.getCalls().filter((call) => call.lastArg?.message === "Price Request Settled ✅");
    assert.equal(settlementLogs.length, 0, "No settlement logs should be generated on subsequent runs");
  });
});
