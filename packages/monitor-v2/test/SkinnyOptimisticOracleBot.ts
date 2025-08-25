import type { Provider } from "@ethersproject/abstract-provider";
import "@nomiclabs/hardhat-ethers";
import { ExpandedERC20Ethers, TimerEthers } from "@uma/contracts-node";
import { createNewLogger, spyLogIncludes, spyLogLevel, SpyTransport } from "@uma/financial-templates-lib";
import { BlockFinder } from "@uma/sdk";
import { assert } from "chai";
import sinon from "sinon";
import { BotModes, MonitoringParams, OracleType } from "../src/bot-oo/common";
import { settleRequests } from "../src/bot-oo/SettleRequests";
import { defaultLiveness, defaultOptimisticOracleV2Identifier } from "./constants";
import { skinnyOptimisticOracleFixture, SkinnyOptimisticOracleEthers } from "./fixtures/SkinnyOptimisticOracle.Fixture";
import { umaEcosystemFixture } from "./fixtures/UmaEcosystem.Fixture";
import { hre, Signer, toUtf8Bytes, toUtf8String } from "./utils";

const ethers = hre.ethers;

const createMonitoringParams = async (oracleType: OracleType, contractAddress: string): Promise<MonitoringParams> => {
  // get hardhat signer
  const [signer] = await ethers.getSigners();
  const botModes: BotModes = {
    settleRequestsEnabled: true,
  };
  return {
    provider: ethers.provider as Provider,
    chainId: (await ethers.provider.getNetwork()).chainId,
    botModes,
    signer,
    timeLookback: 72 * 60 * 60,
    maxBlockLookBack: 1000,
    blockFinder: new BlockFinder(() => {
      return { number: 0, timestamp: 0 } as any;
    }),
    pollingDelay: 0,
    gasLimitMultiplier: 150,
    oracleType,
    contractAddress,
  };
};

describe("SkinnyOptimisticOracleBot", function () {
  let bondToken: ExpandedERC20Ethers;
  let skinnyOptimisticOracle: SkinnyOptimisticOracleEthers;
  let timer: TimerEthers;
  let requester: Signer;
  let proposer: Signer;

  const ancillaryData = toUtf8Bytes("This is just a test question");

  beforeEach(async function () {
    [requester, proposer] = (await ethers.getSigners()) as Signer[];

    const uma = await umaEcosystemFixture();
    timer = uma.timer;

    const skinnyOO = await skinnyOptimisticOracleFixture();
    bondToken = skinnyOO.bondToken;
    skinnyOptimisticOracle = skinnyOO.skinnyOptimisticOracle;

    // Fund proposer with bond amount and approve Skinny OO to spend bond tokens.
    const bond = ethers.utils.parseEther("1000");
    await bondToken.addMinter(await requester.getAddress());
    await bondToken.mint(await proposer.getAddress(), bond);
    await bondToken.connect(proposer).approve(skinnyOptimisticOracle.address, bond);
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
    const block = await ethers.provider.getBlock(proposeReceipt.blockNumber!);
    await (await timer.setCurrentTime(block.timestamp + defaultLiveness)).wait();

    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);

    await settleRequests(
      spyLogger,
      await createMonitoringParams("SkinnyOptimisticOracle", skinnyOptimisticOracle.address)
    );

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
      spyLogger,
      await createMonitoringParams("SkinnyOptimisticOracle", skinnyOptimisticOracle.address)
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

    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await settleRequests(
      spyLogger,
      await createMonitoringParams("SkinnyOptimisticOracle", skinnyOptimisticOracle.address)
    );

    // Check that no settlement warning logs were generated (but debug logs are OK).
    const settlementLogs = spy.getCalls().filter((call) => call.lastArg?.message === "Price Request Settled ✅");
    assert.equal(settlementLogs.length, 0, "No settlement logs should be generated before liveness expires");
  });
});
