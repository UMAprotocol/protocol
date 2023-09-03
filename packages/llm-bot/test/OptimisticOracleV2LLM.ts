import { ExpandedERC20Ethers, OptimisticOracleV2Ethers, TimerEthers } from "@uma/contracts-node";
import { assert } from "chai";
import {
  Backtest,
  DisputerStrategy,
  OptimisticOracleClientV2,
  OptimisticOracleClientV2FilterDisputeable,
} from "../src/core/OptimisticOracleV2";
import { defaultOptimisticOracleV2Identifier } from "./constants";
import { optimisticOracleV2Fixture } from "./fixtures/OptimisticOracleV2.Fixture";
import { Signer, hre, toUtf8Bytes } from "./utils";
import { umaEcosystemFixture } from "./fixtures/UmaEcosystem.Fixture";

const ethers = hre.ethers;

describe("OptimisticOracleV2Client", function () {
  let bondToken: ExpandedERC20Ethers;
  let optimisticOracleV2: OptimisticOracleV2Ethers;
  let requester: Signer;
  let proposer: Signer;
  let disputer: Signer;
  let oov2Client: OptimisticOracleClientV2;
  let oov2FilterDisputable: OptimisticOracleClientV2FilterDisputeable;
  let timer: TimerEthers;

  const bond = ethers.utils.parseEther("1000");

  const question = "This is just a test question";
  const ancillaryData = toUtf8Bytes(question);

  beforeEach(async function () {
    // Signer from ethers and hardhat-ethers are not version compatible, thus, we cannot use the SignerWithAddress.
    [requester, proposer, disputer] = (await ethers.getSigners()) as Signer[];

    // Get contract instances.
    const umaContracts = await umaEcosystemFixture();
    const optimisticOracleV2Contracts = await optimisticOracleV2Fixture();
    timer = umaContracts.timer;
    bondToken = optimisticOracleV2Contracts.bondToken;
    optimisticOracleV2 = optimisticOracleV2Contracts.optimisticOracleV2;

    oov2Client = new OptimisticOracleClientV2(optimisticOracleV2.provider);

    oov2FilterDisputable = new OptimisticOracleClientV2FilterDisputeable();

    // Fund proposer and disputer with bond amount and approve Optimistic Oracle V2 to spend bond tokens.
    await bondToken.addMinter(await requester.getAddress());
    await bondToken.mint(await proposer.getAddress(), bond);
    await bondToken.mint(await disputer.getAddress(), bond);
    await bondToken.connect(proposer).approve(optimisticOracleV2.address, bond);
    await bondToken.connect(disputer).approve(optimisticOracleV2.address, bond);
  });
  it("Fetches price requests", async function () {
    const tx = await optimisticOracleV2.requestPrice(
      defaultOptimisticOracleV2Identifier,
      0,
      ancillaryData,
      bondToken.address,
      0
    );

    const oov2ClientUpdated = await oov2Client.updateWithBlockRange();
    const requests = Array.from(oov2ClientUpdated.requests.values());
    const request = requests[0];

    assert.equal(requests.length, 1);
    assert.equal(request.requester, await requester.getAddress());
    assert.equal(request.identifier, ethers.utils.parseBytes32String(defaultOptimisticOracleV2Identifier));
    assert.equal(request.timestamp, 0);
    assert.equal(request.body, question);
    assert.equal(request.requestTx, tx.hash);
  });

  it("Handles wrong block range", async function () {
    const wrongBlockRange: [number, number] = [100, 99];
    // should fail when calling updateWithBlockRange
    try {
      await oov2Client.updateWithBlockRange(wrongBlockRange);
      assert.fail("Expected function to throw an error, but it did not.");
    } catch (error) {
      assert.ok(error instanceof Error);
      assert.strictEqual(error.message, "Start block number should be less than or equal to end block number");
    }
  });

  it("Handles No Requests Found", async function () {
    const latestBlockNumber = await optimisticOracleV2.provider.getBlockNumber();
    const emptyBlockRange: [number, number] = [latestBlockNumber + 1, latestBlockNumber + 10];
    const oov2ClientUpdated = await oov2Client.updateWithBlockRange(emptyBlockRange);
    const requests = Array.from(oov2ClientUpdated.requests.values());
    assert.isArray(requests);
    assert.isEmpty(requests);
  });

  it("Filters disputeable requests", async function () {
    await (
      await optimisticOracleV2.requestPrice(defaultOptimisticOracleV2Identifier, 0, ancillaryData, bondToken.address, 0)
    ).wait();

    await (await bondToken.connect(proposer).approve(optimisticOracleV2.address, bond)).wait();
    await (
      await optimisticOracleV2
        .connect(proposer)
        .proposePrice(await requester.getAddress(), defaultOptimisticOracleV2Identifier, 0, ancillaryData, 0)
    ).wait();

    const oov2ClientUpdated = await oov2Client.updateWithBlockRange();
    const requests = Array.from(oov2ClientUpdated.requests.values());
    const filteredRequests = await oov2FilterDisputable.filter(requests);

    assert(filteredRequests.length === 1);
  });

  it("Strategy works with backtest", async function () {
    await (
      await optimisticOracleV2.requestPrice(defaultOptimisticOracleV2Identifier, 0, ancillaryData, bondToken.address, 0)
    ).wait();

    await (await bondToken.connect(proposer).approve(optimisticOracleV2.address, bond)).wait();
    const receipt = await (
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

    // get the timestamp of the block of the proposePrice tx
    const block = await optimisticOracleV2.provider.getBlock(receipt.blockNumber);
    const timestamp = block.timestamp;

    await (await timer.setCurrentTime(timestamp + (await optimisticOracleV2.defaultLiveness()).toNumber())).wait();

    await (
      await optimisticOracleV2.settle(
        await requester.getAddress(),
        defaultOptimisticOracleV2Identifier,
        0,
        ancillaryData
      )
    ).wait();

    const oov2ClientUpdated = await oov2Client.updateWithBlockRange();
    const requests = Array.from(oov2ClientUpdated.requests.values());
    const filteredRequests = await oov2FilterDisputable.filter(requests);

    const disputable = await Promise.all(filteredRequests.map(DisputerStrategy.process));

    const correctness = disputable.map((request) => Backtest.test(request));

    assert(filteredRequests.length === 1);

    assert(correctness[0]);
  });
});
