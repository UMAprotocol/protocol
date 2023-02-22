import { ExpandedERC20Ethers, MockOracleAncillaryEthers, OptimisticOracleV3Ethers } from "@uma/contracts-node";
import { createNewLogger, spyLogIncludes, spyLogLevel, SpyTransport } from "@uma/financial-templates-lib";
import { assert } from "chai";
import sinon from "sinon";
import { defaultLiveness } from "./constants";
import { ContractTransaction, hardhatTime, hre, Provider, Signer, toUtf8Bytes, toUtf8String } from "./utils";
import { umaEcosystemFixture } from "./fixtures/UmaEcosystem.Fixture";
import { optimisticOracleV3Fixture } from "./fixtures/OptimisticOracleV3.Fixture";
import { MonitoringParams, BotModes } from "../src/monitor-oo-v3/common";
import { monitorAssertions } from "../src/monitor-oo-v3/MonitorAssertions";

const ethers = hre.ethers;

// Get assertionId from the first AssertionMade event in the assertion transaction.
const getAssertionId = async (
  tx: ContractTransaction,
  optimisticOracleV3: OptimisticOracleV3Ethers
): Promise<string> => {
  await tx.wait();
  return (
    await optimisticOracleV3.queryFilter(optimisticOracleV3.filters.AssertionMade(), tx.blockNumber, tx.blockNumber)
  )[0].args.assertionId;
};

// Get block number from transaction (or 0 if transaction is not mined).
const getBlockNumber = async (tx: ContractTransaction): Promise<number> => {
  await tx.wait();
  const blockNumber = tx.blockNumber ? tx.blockNumber : 0;
  return blockNumber;
};

// Create monitoring params for single block to pass to monitor modules.
const createMonitoringParams = async (blockNumber: number): Promise<MonitoringParams> => {
  // Bot modes are not used as we are calling monitor modules directly.
  const botModes: BotModes = {
    assertionsEnabled: false,
    disputesEnabled: false,
    settlementsEnabled: false,
  };
  return {
    provider: ethers.provider as Provider,
    chainId: (await ethers.provider.getNetwork()).chainId,
    blockRange: { start: blockNumber, end: blockNumber },
    pollingDelay: 0,
    botModes,
  };
};

describe("OptimisticOracleV3Monitor", function () {
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
    mockOracle = (await umaEcosystemFixture()).mockOracle;
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
  it("Monitor assertion", async function () {
    // Make assertion.
    const assertionTx = await optimisticOracleV3
      .connect(asserter)
      .assertTruthWithDefaults(claim, await asserter.getAddress());
    const assertionBlockNumber = await getBlockNumber(assertionTx);
    const assertionId = await getAssertionId(assertionTx, optimisticOracleV3);

    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorAssertions(spyLogger, await createMonitoringParams(assertionBlockNumber));

    // When calling monitoring module directly there should be only one log (index 0) with the assertion caught by spy.
    assert.equal(spy.getCall(0).lastArg.at, "OOv3Monitor");
    assert.equal(spy.getCall(0).lastArg.message, "Assertion made 🙋");
    assert.equal(spyLogLevel(spy, 0), "warn");
    assert.isTrue(spyLogIncludes(spy, 0, assertionId));
    assert.isTrue(spyLogIncludes(spy, 0, assertionTx.hash));
    assert.isTrue(spyLogIncludes(spy, 0, toUtf8String(claim)));
  });
  it("Monitor truthful settlement", async function () {
    // Make assertion.
    const assertionTx = await optimisticOracleV3
      .connect(asserter)
      .assertTruthWithDefaults(claim, await asserter.getAddress());
    const assertionId = await getAssertionId(assertionTx, optimisticOracleV3);

    // Settle assertion after the liveness period.
    await hardhatTime.increase(defaultLiveness);
    await optimisticOracleV3.connect(asserter).settleAssertion(assertionId);
  });
  it("Monitor dispute", async function () {
    // Make assertion.
    const assertionTx = await optimisticOracleV3
      .connect(asserter)
      .assertTruthWithDefaults(claim, await asserter.getAddress());
    const assertionId = await getAssertionId(assertionTx, optimisticOracleV3);

    // Dispute assertion.
    await optimisticOracleV3.connect(disputer).disputeAssertion(assertionId, await disputer.getAddress());
  });
  it("Monitor settlement of false assertion", async function () {
    // Make assertion.
    const assertionTx = await optimisticOracleV3
      .connect(asserter)
      .assertTruthWithDefaults(claim, await asserter.getAddress());
    const assertionId = await getAssertionId(assertionTx, optimisticOracleV3);

    // Dispute assertion.
    const disputeTx = await optimisticOracleV3
      .connect(disputer)
      .disputeAssertion(assertionId, await disputer.getAddress());

    // Get oracle request from the first PriceRequestAdded event in the dispute transaction.
    const oracleRequest = (
      await mockOracle.queryFilter(mockOracle.filters.PriceRequestAdded(), disputeTx.blockNumber, disputeTx.blockNumber)
    )[0].args;

    // Resolve assertion as false.
    await mockOracle
      .connect(disputer)
      .pushPrice(oracleRequest.identifier, oracleRequest.time, oracleRequest.ancillaryData, 0);

    // Settle assertion.
    await optimisticOracleV3.connect(disputer).settleAssertion(assertionId);
  });
});
