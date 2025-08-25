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
import { optimisticOracleV1Fixture, OptimisticOracleV1Ethers } from "./fixtures/OptimisticOracleV1.Fixture";
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

describe("OptimisticOracleV1Bot", function () {
  let bondToken: ExpandedERC20Ethers;
  let optimisticOracleV1: OptimisticOracleV1Ethers;
  let timer: TimerEthers;
  let requester: Signer;
  let proposer: Signer;

  const ancillaryData = toUtf8Bytes("This is just a test question");

  beforeEach(async function () {
    [requester, proposer] = (await ethers.getSigners()) as Signer[];

    const uma = await umaEcosystemFixture();
    timer = uma.timer;

    const oov1 = await optimisticOracleV1Fixture();
    bondToken = oov1.bondToken;
    optimisticOracleV1 = oov1.optimisticOracleV1;

    // Fund proposer with bond amount and approve OOV1 to spend bond tokens.
    const bond = ethers.utils.parseEther("1000");
    await bondToken.addMinter(await requester.getAddress());
    await bondToken.mint(await proposer.getAddress(), bond);
    await bondToken.connect(proposer).approve(optimisticOracleV1.address, bond);
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
    const block = await ethers.provider.getBlock(proposeReceipt.blockNumber!);
    await (await timer.setCurrentTime(block.timestamp + defaultLiveness)).wait();

    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);

    await settleRequests(spyLogger, await createMonitoringParams("OptimisticOracle", optimisticOracleV1.address));

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
    await settleRequests(spyLogger, await createMonitoringParams("OptimisticOracle", optimisticOracleV1.address));

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

    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await settleRequests(spyLogger, await createMonitoringParams("OptimisticOracle", optimisticOracleV1.address));

    // Check that no settlement warning logs were generated (but debug logs are OK).
    const settlementLogs = spy.getCalls().filter((call) => call.lastArg?.message === "Price Request Settled ✅");
    assert.equal(settlementLogs.length, 0, "No settlement logs should be generated before liveness expires");
  });
});
