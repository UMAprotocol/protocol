import { ExpandedERC20Ethers, OptimisticOracleV2Ethers } from "@uma/contracts-node";
import { SpyTransport, createNewLogger } from "@uma/financial-templates-lib";
import { assert } from "chai";
import sinon from "sinon";
import { disputeDisputableRequests } from "../src/dispute-bot/DisputeDisputableRequests";
import { BotModes, MonitoringParams } from "../src/dispute-bot/common";
import { defaultOptimisticOracleV2Identifier } from "./constants";
import { optimisticOracleV2Fixture } from "./fixtures/OptimisticOracleV2.Fixture";
import { Provider, Signer, hre, toUtf8Bytes } from "./utils";

const ethers = hre.ethers;

const createMonitoringParams = async (): Promise<MonitoringParams> => {
  // get chain id
  const chainId = await hre.ethers.provider.getNetwork().then((network) => network.chainId);
  // get hardhat signer
  const [signer] = await ethers.getSigners();
  // Bot modes are not used as we are calling monitor modules directly.
  const botModes: BotModes = {
    disputeDisputableRequests: true,
  };
  return {
    chainId: chainId,
    provider: ethers.provider as Provider,
    pollingDelay: 0,
    botModes,
    signer,
    maxBlockLookBack: 1000,
    blockLookback: 1000,
  };
};

describe("LLMDisputeDisputableRequests", function () {
  let bondToken: ExpandedERC20Ethers;
  let optimisticOracleV2: OptimisticOracleV2Ethers;
  let requester: Signer;
  let proposer: Signer;
  let disputer: Signer;

  const bond = ethers.utils.parseEther("1000");

  const question = "This is just a test question";
  const ancillaryData = toUtf8Bytes(question);

  beforeEach(async function () {
    // Signer from ethers and hardhat-ethers are not version compatible, thus, we cannot use the SignerWithAddress.
    [requester, proposer, disputer] = (await ethers.getSigners()) as Signer[];

    // Get contract instances.
    const optimisticOracleV2Contracts = await optimisticOracleV2Fixture();

    bondToken = optimisticOracleV2Contracts.bondToken;
    optimisticOracleV2 = optimisticOracleV2Contracts.optimisticOracleV2;

    // Fund proposer and disputer with bond amount and approve Optimistic Oracle V2 to spend bond tokens.
    await bondToken.addMinter(await requester.getAddress());
    await bondToken.mint(await proposer.getAddress(), bond);
    await bondToken.mint(await disputer.getAddress(), bond);
    await bondToken.connect(proposer).approve(optimisticOracleV2.address, bond);
    await bondToken.connect(disputer).approve(optimisticOracleV2.address, bond);
  });

  it("Disputes disputable requests", async function () {
    await (
      await optimisticOracleV2.requestPrice(defaultOptimisticOracleV2Identifier, 0, ancillaryData, bondToken.address, 0)
    ).wait();

    await (await bondToken.connect(proposer).approve(optimisticOracleV2.address, bond)).wait();
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

    await disputeDisputableRequests(spyLogger, await createMonitoringParams());
    assert.equal(spy.getCall(0).lastArg.at, "LLMDisputeBot");
  });
});
