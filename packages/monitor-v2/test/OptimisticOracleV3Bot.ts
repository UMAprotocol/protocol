import type { Provider } from "@ethersproject/abstract-provider";
import { ExpandedERC20Ethers, MockOracleAncillaryEthers, OptimisticOracleV3Ethers } from "@uma/contracts-node";
import { createNewLogger, spyLogIncludes, spyLogLevel, SpyTransport } from "@uma/financial-templates-lib";
import { BlockFinder } from "@uma/sdk";
import { assert } from "chai";
import sinon from "sinon";
import { BotModes, MonitoringParams } from "../src/bot-oo-v3/common";
import { settleAssertions } from "../src/bot-oo-v3/SettleAssertions";
import { defaultLiveness } from "./constants";
import { optimisticOracleV3Fixture } from "./fixtures/OptimisticOracleV3.Fixture";
import { umaEcosystemFixture } from "./fixtures/UmaEcosystem.Fixture";
import { getBlockNumberFromTx, hardhatTime, hre, Signer, toUtf8Bytes, toUtf8String } from "./utils";
import "@nomiclabs/hardhat-ethers";
const ethers = hre.ethers;

// Create monitoring params for single block to pass to monitor modules.
const createMonitoringParams = async (): Promise<MonitoringParams> => {
  // get hardhat signer
  const [signer] = await ethers.getSigners();
  // Bot modes are not used as we are calling monitor modules directly.
  const botModes: BotModes = {
    settleAssertionsEnabled: false,
  };
  return {
    provider: ethers.provider as Provider,
    chainId: (await ethers.provider.getNetwork()).chainId,
    botModes,
    signer,
    timeLookback: 72 * 60 * 60,
    maxBlockLookBack: 1000,
    blockFinder: new BlockFinder(() => {
      return { number: 0, timestamp: 0 };
    }),
    pollingDelay: 0,
  };
};

describe("OptimisticOracleV3Bot", function () {
  let mockOracle: MockOracleAncillaryEthers;
  let bondToken: ExpandedERC20Ethers;
  let optimisticOracleV3: OptimisticOracleV3Ethers;
  let deployer: Signer;
  let asserter: Signer;
  let disputer: Signer;

  const claim = toUtf8Bytes("This is just a test claim");

  beforeEach(async function () {
    // Signer from ethers and hardhat-ethers are not version compatible, thus, we cannot use the SignerWithAddress.
    [deployer, asserter, disputer] = (await ethers.getSigners()) as Signer[];

    // Get contract instances.
    const umaContracts = await umaEcosystemFixture();
    mockOracle = umaContracts.mockOracle;
    const optimisticOracleV3Contracts = await optimisticOracleV3Fixture();
    bondToken = optimisticOracleV3Contracts.bondToken;
    optimisticOracleV3 = optimisticOracleV3Contracts.optimisticOracleV3;

    // Fund asserter and disputer with minimum bond amount and approve Optimistic Oracle V3 to spend bond tokens.
    const minimumBondAmount = await optimisticOracleV3.getMinimumBond(bondToken.address);
    await bondToken.addMinter(await deployer.getAddress());
    await bondToken.mint(await asserter.getAddress(), minimumBondAmount);
    await bondToken.mint(await disputer.getAddress(), minimumBondAmount);
    await bondToken.connect(asserter).approve(optimisticOracleV3.address, minimumBondAmount);
    await bondToken.connect(disputer).approve(optimisticOracleV3.address, minimumBondAmount);
  });
  it("Settle assertion happy path", async function () {
    // Make assertion.
    const assertionTx = await optimisticOracleV3
      .connect(asserter)
      .assertTruthWithDefaults(claim, await asserter.getAddress());
    // const assertionId = await getAssertionId(assertionTx, optimisticOracleV3);
    const assertionBlockNumber = await getBlockNumberFromTx(assertionTx);

    const assertionMadeEvent = (
      await optimisticOracleV3.queryFilter(optimisticOracleV3.filters.AssertionMade(), assertionBlockNumber)
    )[0];

    // Call monitorAssertions directly for the block when the assertion was made.
    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await settleAssertions(spyLogger, await createMonitoringParams());

    // No logs should be generated as there are no assertions to settle.
    assert.isNull(spy.getCall(0));

    // move time forward to the execution time.
    await hardhatTime.increase(defaultLiveness);
    await settleAssertions(spyLogger, await createMonitoringParams());

    // When calling monitoring module directly there should be only one log (index 0) with the assertion caught by spy.
    assert.equal(spy.getCall(0).lastArg.at, "OOv3Bot");
    assert.equal(spy.getCall(0).lastArg.message, "Assertion Settled ✅");
    assert.equal(spyLogLevel(spy, 0), "warn");
    assert.isTrue(spyLogIncludes(spy, 0, assertionMadeEvent.args.assertionId));
    assert.isTrue(spyLogIncludes(spy, 0, toUtf8String(claim)));
    assert.isTrue(spyLogIncludes(spy, 0, "Settlement Resolution: true"));
    assert.equal(spy.getCall(0).lastArg.notificationPath, "optimistic-oracle");

    spy.resetHistory();
    await settleAssertions(spyLogger, await createMonitoringParams());
    // There should be no logs as there are no assertions to settle.
    assert.isNull(spy.getCall(0));
  });
  it("Settle assertion with dispute", async function () {
    // Make assertion.
    const assertionTx = await optimisticOracleV3
      .connect(asserter)
      .assertTruthWithDefaults(claim, await asserter.getAddress());
    // const assertionId = await getAssertionId(assertionTx, optimisticOracleV3);
    const assertionBlockNumber = await getBlockNumberFromTx(assertionTx);

    const assertionMadeEvent = (
      await optimisticOracleV3.queryFilter(optimisticOracleV3.filters.AssertionMade(), assertionBlockNumber)
    )[0];

    // Dispute assertion.
    const disputeTx = await optimisticOracleV3
      .connect(disputer)
      .disputeAssertion(assertionMadeEvent.args.assertionId, await disputer.getAddress());

    // Get oracle request from the first PriceRequestAdded event in the dispute transaction.
    const oracleRequest = (
      await mockOracle.queryFilter(mockOracle.filters.PriceRequestAdded(), disputeTx.blockNumber, disputeTx.blockNumber)
    )[0].args;

    // Call monitorAssertions directly for the block when the assertion was made.
    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await settleAssertions(spyLogger, await createMonitoringParams());

    // No logs should be generated as there are no assertions to settle.
    assert.isNull(spy.getCall(0));

    // Resolve assertion as false.
    await mockOracle
      .connect(disputer)
      .pushPrice(oracleRequest.identifier, oracleRequest.time, oracleRequest.ancillaryData, 0);

    await settleAssertions(spyLogger, await createMonitoringParams());

    // When calling monitoring module directly there should be only one log (index 0) with the assertion caught by spy.
    assert.equal(spy.getCall(0).lastArg.at, "OOv3Bot");
    assert.equal(spy.getCall(0).lastArg.message, "Assertion Settled ✅");
    assert.equal(spyLogLevel(spy, 0), "warn");
    assert.isTrue(spyLogIncludes(spy, 0, assertionMadeEvent.args.assertionId));
    assert.isTrue(spyLogIncludes(spy, 0, toUtf8String(claim)));
    assert.isTrue(spyLogIncludes(spy, 0, "Settlement Resolution: false"));
    assert.equal(spy.getCall(0).lastArg.notificationPath, "optimistic-oracle");

    spy.resetHistory();
    await settleAssertions(spyLogger, await createMonitoringParams());
    // There should be no logs as there are no assertions to settle.
    assert.isNull(spy.getCall(0));
  });
});
