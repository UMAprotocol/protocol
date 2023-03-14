import { ExpandedERC20Ethers, OptimisticGovernorEthers } from "@uma/contracts-node";
import { createNewLogger, spyLogIncludes, spyLogLevel, SpyTransport } from "@uma/financial-templates-lib";
import { assert } from "chai";
import sinon from "sinon";
import { BotModes, MonitoringParams } from "../src/monitor-og/common";
import { monitorTransactionsProposed } from "../src/monitor-og/MonitorTransactionsProposed";
import { optimisticGovernorFixture } from "./fixtures/OptimisticGovernor.Fixture";
import { getBlockNumberFromTx, hre, parseEther, Provider, Signer, toUtf8Bytes, toUtf8String } from "./utils";

const ethers = hre.ethers;

// Get assertionId from the first AssertionMade event in the assertion transaction.
// const getAssertionId = async (
//   tx: ContractTransaction,
//   optimisticOracleV3: OptimisticOracleV3Ethers
// ): Promise<string> => {
//   await tx.wait();
//   return (
//     await optimisticOracleV3.queryFilter(optimisticOracleV3.filters.AssertionMade(), tx.blockNumber, tx.blockNumber)
//   )[0].args.assertionId;
// };

// Create monitoring params for single block to pass to monitor modules.
const createMonitoringParams = async (blockNumber: number): Promise<MonitoringParams> => {
  // Bot modes are not used as we are calling monitor modules directly.
  const botModes: BotModes = {
    transactionsProposedEnabled: false,
  };
  return {
    provider: ethers.provider as Provider,
    chainId: (await ethers.provider.getNetwork()).chainId,
    blockRange: { start: blockNumber, end: blockNumber },
    pollingDelay: 0,
    botModes,
  };
};

describe("OptimisticGovernorMonitor", function () {
  // let mockOracle: MockOracleAncillaryEthers;
  let bondToken: ExpandedERC20Ethers;
  // let optimisticOracleV3: OptimisticOracleV3Ethers;
  let optimisticGovernor: OptimisticGovernorEthers;
  let deployer: Signer;
  let random: Signer;
  let proposer: Signer;

  beforeEach(async function () {
    // Signer from ethers and hardhat-ethers are not version compatible, thus, we cannot use the SignerWithAddress.
    [deployer, random, proposer] = (await ethers.getSigners()) as Signer[];

    // Get contract instances.
    // mockOracle = (await umaEcosystemFixture()).mockOracle;
    const optimisticGovernorContracts = await optimisticGovernorFixture();
    bondToken = optimisticGovernorContracts.bondToken;
    // optimisticOracleV3 = optimisticGovernorContracts.optimisticOracleV3;
    optimisticGovernor = optimisticGovernorContracts.optimisticGovernor;

    // Fund avatars with bond tokens.
    await bondToken.addMinter(await deployer.getAddress());
    await bondToken.mint(optimisticGovernorContracts.avatar.address, parseEther("500"));

    await bondToken.mint(await proposer.getAddress(), await optimisticGovernor.getProposalBond());
    await bondToken.connect(proposer).approve(optimisticGovernor.address, await optimisticGovernor.getProposalBond());
  });
  it("Monitor TransactionsProposed", async function () {
    // Construct the transaction data
    const txnData1 = await bondToken.populateTransaction.transfer(await proposer.getAddress(), parseEther("250"));
    const txnData2 = await bondToken.populateTransaction.transfer(await random.getAddress(), parseEther("250"));

    if (!txnData1.data || !txnData2.data) throw new Error("Transaction data is undefined");

    const operation = 0; // 0 for call, 1 for delegatecall

    // Send the proposal with multiple transactions.
    const transactions = [
      { to: bondToken.address, operation, value: 0, data: txnData1.data },
      { to: bondToken.address, operation, value: 0, data: txnData2.data },
    ];

    const explanation = toUtf8Bytes("These transactions were approved by majority vote on Snapshot.");

    const proposeTx = await optimisticGovernor.connect(proposer).proposeTransactions(transactions, explanation);

    const proposeBlockNumber = await getBlockNumberFromTx(proposeTx);

    const transactionProposedEvent = (
      await optimisticGovernor.queryFilter(
        optimisticGovernor.filters.TransactionsProposed(),
        proposeBlockNumber,
        proposeBlockNumber
      )
    )[0];

    // Call monitorTransactionsProposed directly for the block when the proposeTransactions was made.
    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorTransactionsProposed(spyLogger, await createMonitoringParams(proposeBlockNumber));

    // When calling monitoring module directly there should be only one log (index 0) with the proposal caught by spy.
    assert.equal(spy.getCall(0).lastArg.at, "OptimisticGovernorMonitor");
    assert.equal(spy.getCall(0).lastArg.message, "Transactions Proposed 📝");
    assert.equal(spyLogLevel(spy, 0), "warn");
    assert.isTrue(spyLogIncludes(spy, 0, transactionProposedEvent.args.assertionId));
    assert.isTrue(spyLogIncludes(spy, 0, transactionProposedEvent.args.proposer));
    assert.isTrue(spyLogIncludes(spy, 0, transactionProposedEvent.args.rules));
    assert.isTrue(spyLogIncludes(spy, 0, transactionProposedEvent.args.proposalHash));
    assert.isTrue(spyLogIncludes(spy, 0, toUtf8String(explanation)));
    assert.equal(spy.getCall(0).lastArg.notificationPath, "optimistic-governor");
  });
});
