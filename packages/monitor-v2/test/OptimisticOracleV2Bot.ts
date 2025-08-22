import type { Provider } from "@ethersproject/abstract-provider";
import "@nomiclabs/hardhat-ethers";
import { ExpandedERC20Ethers, OptimisticOracleV2Ethers, TimerEthers } from "@uma/contracts-node";
import { createNewLogger, spyLogIncludes, spyLogLevel, SpyTransport } from "@uma/financial-templates-lib";
import { BlockFinder } from "@uma/sdk";
import { assert } from "chai";
import sinon from "sinon";
import { BotModes, MonitoringParams } from "../src/bot-oo-v2/common";
import { settleRequests } from "../src/bot-oo-v2/SettleRequests";
import { defaultLiveness, defaultOptimisticOracleV2Identifier } from "./constants";
import { optimisticOracleV2Fixture } from "./fixtures/OptimisticOracleV2.Fixture";
import { umaEcosystemFixture } from "./fixtures/UmaEcosystem.Fixture";
import { hre, Signer, toUtf8Bytes, toUtf8String } from "./utils";

const ethers = hre.ethers;

const createMonitoringParams = async (): Promise<MonitoringParams> => {
  // get hardhat signer
  const [signer] = await ethers.getSigners();
  const botModes: BotModes = {
    settleRequestsEnabled: false,
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
  };
};

describe("OptimisticOracleV2Bot", function () {
  let bondToken: ExpandedERC20Ethers;
  let optimisticOracleV2: OptimisticOracleV2Ethers;
  let timer: TimerEthers;
  let requester: Signer;
  let proposer: Signer;

  const ancillaryData = toUtf8Bytes("This is just a test question");

  beforeEach(async function () {
    [requester, proposer] = (await ethers.getSigners()) as Signer[];

    const uma = await umaEcosystemFixture();
    timer = uma.timer;

    const oov2 = await optimisticOracleV2Fixture();
    bondToken = oov2.bondToken;
    optimisticOracleV2 = oov2.optimisticOracleV2;

    // Fund proposer with bond amount and approve OOV2 to spend bond tokens.
    const bond = ethers.utils.parseEther("1000");
    await bondToken.addMinter(await requester.getAddress());
    await bondToken.mint(await proposer.getAddress(), bond);
    await bondToken.connect(proposer).approve(optimisticOracleV2.address, bond);
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
    const block = await ethers.provider.getBlock(proposeReceipt.blockNumber!);
    await (await timer.setCurrentTime(block.timestamp + defaultLiveness)).wait();

    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);

    await settleRequests(spyLogger, await createMonitoringParams());

    assert.equal(spy.getCall(0).lastArg.at, "OOv2Bot");
    assert.equal(spy.getCall(0).lastArg.message, "Price Request Settled ✅");
    assert.equal(spyLogLevel(spy, 0), "warn");
    assert.isTrue(spyLogIncludes(spy, 0, toUtf8String(ancillaryData)));
    assert.isTrue(spyLogIncludes(spy, 0, "Resolved Price"));
    assert.equal(spy.getCall(0).lastArg.notificationPath, "optimistic-oracle");

    // Subsequent run should produce no logs.
    spy.resetHistory();
    await settleRequests(spyLogger, await createMonitoringParams());
    assert.isNull(spy.getCall(0));
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

    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await settleRequests(spyLogger, await createMonitoringParams());

    // No logs should be generated as not yet settleable.
    assert.isNull(spy.getCall(0));
  });
});
