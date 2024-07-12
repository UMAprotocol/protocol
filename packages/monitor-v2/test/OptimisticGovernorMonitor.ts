import { calculateProxyAddress } from "@gnosis.pm/zodiac";
import { time as hardhatTime } from "@nomicfoundation/hardhat-network-helpers";
import {
  ExpandedERC20Ethers,
  ModuleProxyFactoryEthers,
  OptimisticGovernorEthers,
  OptimisticOracleV3Ethers,
  TestAvatarEthers,
  TimerEthers,
} from "@uma/contracts-node";
import { createNewLogger, spyLogIncludes, spyLogLevel, SpyTransport } from "@uma/financial-templates-lib";
import { assert } from "chai";
import { TransactionResponse } from "@ethersproject/abstract-provider";
import { network } from "hardhat";
import sinon from "sinon";
import { initMonitoringParams, MonitoringParams, SupportedBonds } from "../src/monitor-og/common";
import {
  monitorProposalDeleted,
  monitorProposalExecuted,
  monitorProxyDeployments,
  monitorSetCollateralAndBond,
  monitorSetEscalationManager,
  monitorSetIdentifier,
  monitorSetLiveness,
  monitorSetRules,
  monitorTransactionsExecuted,
  monitorTransactionsProposed,
} from "../src/monitor-og/MonitorEvents";
import { executeProposals, proposeTransactions } from "../src/monitor-og/oSnapAutomation";
import * as osnapAutomation from "../src/monitor-og/oSnapAutomation";
import { parseRules, RulesParameters } from "../src/monitor-og/SnapshotVerification";
import { optimisticGovernorFixture } from "./fixtures/OptimisticGovernor.Fixture";
import { umaEcosystemFixture } from "./fixtures/UmaEcosystem.Fixture";
import {
  formatBytes32String,
  getBlockNumberFromTx,
  getContractFactory,
  hre,
  parseEther,
  Signer,
  toUtf8Bytes,
  toUtf8String,
} from "./utils";
import { getContractInstanceWithProvider } from "../src/utils/contracts";
import { MainTransaction } from "../src/monitor-og/SnapshotVerification";
const ethers = hre.ethers;

interface OGModuleProxyDeployment {
  customAvatar: TestAvatarEthers;
  ogModuleProxy: OptimisticGovernorEthers;
  proxyCreationTx: TransactionResponse;
}

interface ExtraParams {
  ogDiscovery?: boolean;
  signer?: Signer;
  supportedBonds?: SupportedBonds;
  submitAutomation?: boolean;
  assertionBlacklist?: string[];
}

describe("OptimisticGovernorMonitor", function () {
  let bondToken: ExpandedERC20Ethers;
  let optimisticOracleV3: OptimisticOracleV3Ethers;
  let optimisticGovernor: OptimisticGovernorEthers;
  let moduleProxyFactory: ModuleProxyFactoryEthers;
  let avatar: TestAvatarEthers;
  let deployer: Signer;
  let disputer: Signer;
  let random: Signer;
  let proposer: Signer;
  let executor: Signer;
  let timer: TimerEthers;

  // Create monitoring params for single block to pass to monitor modules.
  const createMonitoringParams = async (
    blockNumber: number,
    extraParams: ExtraParams = {}
  ): Promise<MonitoringParams> => {
    const env: NodeJS.ProcessEnv = {
      CHAIN_ID: (await ethers.provider.getNetwork()).chainId.toString(),
      MODULE_PROXY_FACTORY_ADDRESSES: JSON.stringify([moduleProxyFactory.address]),
      OG_MASTER_COPY_ADDRESSES: JSON.stringify([optimisticGovernor.address]),
      POLLING_DELAY: "0",
    };
    const STARTING_BLOCK_KEY = `STARTING_BLOCK_NUMBER_${env.CHAIN_ID}`;
    const ENDING_BLOCK_KEY = `ENDING_BLOCK_NUMBER_${env.CHAIN_ID}`;
    env[STARTING_BLOCK_KEY] = blockNumber.toString();
    env[ENDING_BLOCK_KEY] = blockNumber.toString();

    // If ogDiscovery is not set or false, add static OG_ADDRESS. Otherwise, tests will use automatic OG discovery.
    if (!extraParams.ogDiscovery) {
      env.OG_ADDRESS = optimisticGovernor.address;
    }

    // submitAutomation defaults to true, only set to false if explicitly set in extraParams.
    if (extraParams.submitAutomation === false) env.SUBMIT_AUTOMATION = "false";

    // assertionBlacklist defaults to empty array, only set if explicitly set in extraParams.
    if (extraParams.assertionBlacklist) env.ASSERTION_BLACKLIST = JSON.stringify(extraParams.assertionBlacklist);

    const initialParams = await initMonitoringParams(env, ethers.provider);

    return { ...initialParams, signer: extraParams.signer, supportedBonds: extraParams.supportedBonds };
  };

  const deployOgModuleProxy = async (parsedRules?: RulesParameters): Promise<OGModuleProxyDeployment> => {
    // Use the same parameters as mastercopy, except for the owner and rules.
    const customAvatar = (await (await getContractFactory("TestAvatar", deployer)).deploy()) as TestAvatarEthers;
    const rules = parsedRules
      ? "I assert that this transaction proposal is valid according to the following rules: Proposals approved on" +
        " Snapshot, as verified at https://snapshot.org/#/" +
        parsedRules.space +
        ", are valid as long as there is a minimum quorum of " +
        parsedRules.quorum +
        " and a minimum voting period of " +
        parsedRules.votingPeriod +
        " hours and it does not appear that the Snapshot voting system is being exploited or is otherwise unavailable." +
        " The quorum and voting period are minimum requirements for a proposal to be valid. Quorum and voting period" +
        " values set for a specific proposal in Snapshot should be used if they are more strict than the rules" +
        " parameter. The explanation included with the on-chain proposal must be the unique IPFS identifier for the" +
        " specific Snapshot proposal that was approved or a unique identifier for a proposal in an alternative" +
        " voting system approved by DAO social consensus if Snapshot is being exploited or is otherwise unavailable."
      : "test proxy rules";
    const initializerParams = ethers.utils.defaultAbiCoder.encode(
      ["address", "address", "uint256", "string", "bytes32", "uint64"],
      [
        customAvatar.address,
        await optimisticGovernor.collateral(),
        await optimisticGovernor.bondAmount(),
        rules,
        await optimisticGovernor.identifier(),
        await optimisticGovernor.liveness(),
      ]
    );
    const initializer = optimisticGovernor.interface.encodeFunctionData("setUp", [initializerParams]);
    const saltNonce = Number(new Date()).toString();
    const proxyAddress = calculateProxyAddress(moduleProxyFactory, optimisticGovernor.address, initializer, saltNonce);

    const proxyCreationTx = await moduleProxyFactory
      .connect(deployer)
      .deployModule(optimisticGovernor.address, initializer, saltNonce);
    await proxyCreationTx.wait();

    const proxyCreationEvent = (
      await moduleProxyFactory.queryFilter(
        moduleProxyFactory.filters.ModuleProxyCreation(),
        proxyCreationTx.blockNumber,
        proxyCreationTx.blockNumber
      )
    )[0];

    assert.equal(proxyCreationEvent.args.proxy, proxyAddress);

    const ogModuleProxy = await getContractInstanceWithProvider<OptimisticGovernorEthers>(
      "OptimisticGovernor",
      ethers.provider,
      proxyAddress
    );

    // Allow proxy to control the avatar.
    await customAvatar.setModule(proxyAddress);

    return { customAvatar, ogModuleProxy, proxyCreationTx };
  };

  beforeEach(async function () {
    // Signer from ethers and hardhat-ethers are not version compatible, thus, we cannot use the SignerWithAddress.
    [deployer, random, proposer, disputer, executor] = (await ethers.getSigners()) as Signer[];

    // Get contract instances.
    const umaContracts = await umaEcosystemFixture();
    const optimisticGovernorContracts = await optimisticGovernorFixture();
    bondToken = optimisticGovernorContracts.bondToken;
    optimisticOracleV3 = optimisticGovernorContracts.optimisticOracleV3;
    optimisticGovernor = optimisticGovernorContracts.optimisticGovernor;
    moduleProxyFactory = optimisticGovernorContracts.moduleProxyFactory;
    avatar = optimisticGovernorContracts.avatar;
    timer = umaContracts.timer;

    await bondToken.addMinter(await deployer.getAddress());
    await bondToken.mint(avatar.address, parseEther("500"));

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
    assert.equal(spy.getCall(0).lastArg.message, "Unverified Transactions Proposed 🚩");
    assert.equal(spyLogLevel(spy, 0), "error");
    assert.isTrue(spyLogIncludes(spy, 0, optimisticGovernor.address));
    assert.isTrue(spyLogIncludes(spy, 0, transactionProposedEvent.args.assertionId));
    assert.isTrue(spyLogIncludes(spy, 0, transactionProposedEvent.args.proposer));
    assert.isTrue(spyLogIncludes(spy, 0, transactionProposedEvent.args.rules));
    assert.isTrue(spyLogIncludes(spy, 0, transactionProposedEvent.args.proposalHash));
    assert.isTrue(spyLogIncludes(spy, 0, toUtf8String(explanation)));
    assert.equal(spy.getCall(0).lastArg.notificationPath, "optimistic-governor");
  });
  it("Monitor TransactionsExecuted and ProposalExecuted", async function () {
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

    // move time forward to the execution time.
    await timer.setCurrentTime(transactionProposedEvent.args.challengeWindowEnds);

    const executedTx = await optimisticGovernor.executeProposal(transactions);
    const executeBlock = await getBlockNumberFromTx(executedTx);

    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorTransactionsExecuted(spyLogger, await createMonitoringParams(executeBlock));

    assert.equal(spy.getCall(0).lastArg.at, "OptimisticGovernorMonitor");
    assert.equal(spy.getCall(0).lastArg.message, "Transactions Executed ✅");
    assert.equal(spyLogLevel(spy, 0), "warn");
    assert.isTrue(spyLogIncludes(spy, 0, optimisticGovernor.address));
    assert.isTrue(spyLogIncludes(spy, 0, transactionProposedEvent.args.assertionId));
    assert.isTrue(spyLogIncludes(spy, 0, transactionProposedEvent.args.proposalHash));
    assert.equal(spy.getCall(0).lastArg.notificationPath, "optimistic-governor");

    const spyTwo = sinon.spy();
    const spyLoggerTwo = createNewLogger([new SpyTransport({}, { spy: spyTwo })]);
    await monitorProposalExecuted(spyLoggerTwo, await createMonitoringParams(executeBlock));

    assert.equal(spyTwo.getCall(0).lastArg.at, "OptimisticGovernorMonitor");
    assert.equal(spyTwo.getCall(0).lastArg.message, "Proposal Executed ✅");
    assert.equal(spyLogLevel(spyTwo, 0), "warn");
    assert.isTrue(spyLogIncludes(spyTwo, 0, optimisticGovernor.address));
    assert.isTrue(spyLogIncludes(spyTwo, 0, transactionProposedEvent.args.assertionId));
    assert.isTrue(spyLogIncludes(spyTwo, 0, transactionProposedEvent.args.proposalHash));
    assert.equal(spyTwo.getCall(0).lastArg.notificationPath, "optimistic-governor");
  });
  it("Monitor ProposalDeleted", async function () {
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

    await bondToken.mint(await disputer.getAddress(), await optimisticGovernor.getProposalBond());
    await bondToken.connect(disputer).approve(optimisticOracleV3.address, await optimisticGovernor.getProposalBond());

    const disputeTx = await optimisticOracleV3
      .connect(disputer)
      .disputeAssertion(transactionProposedEvent.args.assertionId, await disputer.getAddress());

    const disputeBlockNumber = await getBlockNumberFromTx(disputeTx);

    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorProposalDeleted(spyLogger, await createMonitoringParams(disputeBlockNumber));

    assert.equal(spy.getCall(0).lastArg.at, "OptimisticGovernorMonitor");
    assert.equal(spy.getCall(0).lastArg.message, "Proposal Deleted 🗑️");
    assert.equal(spyLogLevel(spy, 0), "error");
    assert.isTrue(spyLogIncludes(spy, 0, optimisticGovernor.address));
    assert.isTrue(spyLogIncludes(spy, 0, transactionProposedEvent.args.assertionId));
    assert.isTrue(spyLogIncludes(spy, 0, transactionProposedEvent.args.proposalHash));
    assert.equal(spy.getCall(0).lastArg.notificationPath, "optimistic-governor");
  });
  it("Monitor admin functions", async function () {
    const ogOwnerAddress = await optimisticGovernor.owner();
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [ogOwnerAddress],
    });

    await hre.network.provider.send("hardhat_setBalance", [
      ogOwnerAddress,
      ethers.utils.parseEther("10.0").toHexString(),
    ]);

    const ogOwner = await ethers.getSigner(await optimisticGovernor.owner());

    const setBondCollateralTx = await optimisticGovernor
      .connect(ogOwner)
      .setCollateralAndBond(bondToken.address, parseEther("1"));

    const setBondCollateralBlockNumber = await getBlockNumberFromTx(setBondCollateralTx);

    let spy = sinon.spy();
    let spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorSetCollateralAndBond(spyLogger, await createMonitoringParams(setBondCollateralBlockNumber));

    assert.equal(spy.getCall(0).lastArg.at, "OptimisticGovernorMonitor");
    assert.equal(spy.getCall(0).lastArg.message, "Collateral And Bond Set 📝");
    assert.isTrue(spyLogIncludes(spy, 0, optimisticGovernor.address));
    assert.isTrue(spyLogIncludes(spy, 0, bondToken.address));
    assert.isTrue(spyLogIncludes(spy, 0, parseEther("1").toString()));
    assert.equal(spyLogLevel(spy, 0), "warn");
    assert.equal(spy.getCall(0).lastArg.notificationPath, "optimistic-governor");

    const newRules = "test rules";
    const setRulesTx = await optimisticGovernor.connect(ogOwner).setRules(newRules);

    const setRulesBlockNumber = await getBlockNumberFromTx(setRulesTx);

    spy = sinon.spy();
    spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorSetRules(spyLogger, await createMonitoringParams(setRulesBlockNumber));

    assert.equal(spy.getCall(0).lastArg.at, "OptimisticGovernorMonitor");
    assert.equal(spy.getCall(0).lastArg.message, "Rules Set 📝");
    assert.isTrue(spyLogIncludes(spy, 0, optimisticGovernor.address));
    assert.isTrue(spyLogIncludes(spy, 0, newRules));
    assert.equal(spyLogLevel(spy, 0), "warn");
    assert.equal(spy.getCall(0).lastArg.notificationPath, "optimistic-governor");

    const newLiveness = 100;
    const setLivenessTx = await optimisticGovernor.connect(ogOwner).setLiveness(newLiveness);

    const setLivenessBlockNumber = await getBlockNumberFromTx(setLivenessTx);

    spy = sinon.spy();
    spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorSetLiveness(spyLogger, await createMonitoringParams(setLivenessBlockNumber));

    assert.equal(spy.getCall(0).lastArg.at, "OptimisticGovernorMonitor");
    assert.equal(spy.getCall(0).lastArg.message, "Liveness Set 📝");
    assert.isTrue(spyLogIncludes(spy, 0, optimisticGovernor.address));
    assert.isTrue(spyLogIncludes(spy, 0, newLiveness.toString()));
    assert.equal(spyLogLevel(spy, 0), "warn");
    assert.equal(spy.getCall(0).lastArg.notificationPath, "optimistic-governor");

    const newIdentifier = formatBytes32String("TEST");
    const setIdentifierTx = await optimisticGovernor.connect(ogOwner).setIdentifier(newIdentifier);

    const setIdentifierBlockNumber = await getBlockNumberFromTx(setIdentifierTx);

    spy = sinon.spy();
    spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorSetIdentifier(spyLogger, await createMonitoringParams(setIdentifierBlockNumber));

    assert.equal(spy.getCall(0).lastArg.at, "OptimisticGovernorMonitor");
    assert.equal(spy.getCall(0).lastArg.message, "Identifier Set 📝");
    assert.isTrue(spyLogIncludes(spy, 0, optimisticGovernor.address));
    assert.isTrue(spyLogIncludes(spy, 0, newIdentifier));
    assert.equal(spyLogLevel(spy, 0), "warn");
    assert.equal(spy.getCall(0).lastArg.notificationPath, "optimistic-governor");

    const newEscalationManager = await timer.address; // Just use the timer address as a random contract address.
    const setEscalationManagerTx = await optimisticGovernor.connect(ogOwner).setEscalationManager(newEscalationManager);

    const setEscalationManagerBlockNumber = await getBlockNumberFromTx(setEscalationManagerTx);

    spy = sinon.spy();
    spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorSetEscalationManager(spyLogger, await createMonitoringParams(setEscalationManagerBlockNumber));

    assert.equal(spy.getCall(0).lastArg.at, "OptimisticGovernorMonitor");
    assert.equal(spy.getCall(0).lastArg.message, "Escalation Manager Set 📝");
    assert.isTrue(spyLogIncludes(spy, 0, optimisticGovernor.address));
    assert.isTrue(spyLogIncludes(spy, 0, newEscalationManager));
    assert.equal(spyLogLevel(spy, 0), "warn");
    assert.equal(spy.getCall(0).lastArg.notificationPath, "optimistic-governor");
  });
  it("Monitor proxy deployment", async function () {
    const { customAvatar, ogModuleProxy, proxyCreationTx } = await deployOgModuleProxy();
    const proxyDeployBlockNumber = await getBlockNumberFromTx(proxyCreationTx);

    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorProxyDeployments(spyLogger, await createMonitoringParams(proxyDeployBlockNumber));

    assert.equal(spy.getCall(0).lastArg.at, "OptimisticGovernorMonitor");
    assert.equal(spy.getCall(0).lastArg.message, "Optimistic Governor Deployed 📝");
    assert.isTrue(spyLogIncludes(spy, 0, ogModuleProxy.address));
    assert.isTrue(spyLogIncludes(spy, 0, customAvatar.address));
    assert.isTrue(spyLogIncludes(spy, 0, optimisticGovernor.address));
    assert.isTrue(spyLogIncludes(spy, 0, proxyCreationTx.hash));
    assert.equal(spyLogLevel(spy, 0), "warn");
    assert.equal(spy.getCall(0).lastArg.notificationPath, "optimistic-governor");
  });
  it("Monitor TransactionsProposed with automatic OG discovery", async function () {
    // Deploy a new OG module proxy and approve the proposal bond.
    const { ogModuleProxy } = await deployOgModuleProxy();
    await bondToken.connect(proposer).approve(ogModuleProxy.address, await ogModuleProxy.getProposalBond());

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

    const proposeTx = await ogModuleProxy.connect(proposer).proposeTransactions(transactions, explanation);

    const proposeBlockNumber = await getBlockNumberFromTx(proposeTx);

    const transactionProposedEvent = (
      await ogModuleProxy.queryFilter(
        ogModuleProxy.filters.TransactionsProposed(),
        proposeBlockNumber,
        proposeBlockNumber
      )
    )[0];

    // Call monitorTransactionsProposed directly for the block when the proposeTransactions was made using automatic OG discovery.
    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorTransactionsProposed(
      spyLogger,
      await createMonitoringParams(proposeBlockNumber, { ogDiscovery: true })
    );

    // When calling monitoring module directly there should be only one log (index 0) with the proposal caught by spy.
    assert.equal(spy.getCall(0).lastArg.at, "OptimisticGovernorMonitor");
    assert.equal(spy.getCall(0).lastArg.message, "Unverified Transactions Proposed 🚩");
    assert.equal(spyLogLevel(spy, 0), "error");
    assert.isTrue(spyLogIncludes(spy, 0, ogModuleProxy.address));
    assert.isTrue(spyLogIncludes(spy, 0, transactionProposedEvent.args.assertionId));
    assert.isTrue(spyLogIncludes(spy, 0, transactionProposedEvent.args.proposer));
    assert.isTrue(spyLogIncludes(spy, 0, transactionProposedEvent.args.rules));
    assert.isTrue(spyLogIncludes(spy, 0, transactionProposedEvent.args.proposalHash));
    assert.isTrue(spyLogIncludes(spy, 0, toUtf8String(explanation)));
    assert.equal(spy.getCall(0).lastArg.notificationPath, "optimistic-governor");
  });
  it("Automatically propose transactions", async function () {
    // Deploy a new OG module proxy and approve the proposal bond.
    const space = "test.eth";
    const { customAvatar, ogModuleProxy } = await deployOgModuleProxy({
      space,
      quorum: 0,
      votingPeriod: 0,
    });
    await bondToken.connect(proposer).approve(ogModuleProxy.address, await ogModuleProxy.getProposalBond());

    // Set supported bond settings.
    const supportedBonds: SupportedBonds = {};
    supportedBonds[bondToken.address] = (await ogModuleProxy.getProposalBond()).toString();

    // Fund the avatar
    await bondToken.mint(customAvatar.address, parseEther("500"));

    // Construct the transaction data for spending tokens from the avatar.
    const txnData1 = await bondToken.populateTransaction.transfer(await proposer.getAddress(), parseEther("250"));
    if (!txnData1.data) throw new Error("Transaction data is undefined");

    // Create the proposal with multiple transactions.
    const transactions = [{ to: bondToken.address, operation: 0, value: 0, data: txnData1.data }];

    const explanationString = "These transactions were approved by majority vote on Snapshot.";

    const mockProposals = [
      {
        space: { id: "test" },
        type: "single-choice",
        choices: ["choice1", "choice2"],
        id: "proposal-id",
        start: 1234567890,
        end: 1234567890,
        state: "active",
        safe: {
          txs: [
            {
              mainTransaction: {
                to: bondToken.address,
                value: "0",
                data: txnData1.data,
                operation: "0" as MainTransaction["operation"],
              },
            },
          ],
          network: "31337",
          umaAddress: ogModuleProxy.address,
        },
        ipfs: explanationString,
        scores: [0, 0],
        scores_total: 0,
        quorum: 100,
      },
    ];

    // Mock Snapshot logic
    sinon.stub(osnapAutomation, "getSupportedSnapshotProposals").resolves(mockProposals);
    sinon.stub(osnapAutomation, "filterUnblockedProposals").callsFake(async (proposals) => proposals);
    sinon.stub(osnapAutomation, "filterVerifiedProposals").callsFake(async (proposals) => proposals);

    const submitProposalsStub = sinon.stub(osnapAutomation, "submitProposals");

    let latestBlockNumber = await ethers.provider.getBlockNumber();
    let spyLogger = createNewLogger([new SpyTransport({}, { spy: sinon.spy() })]);

    // Case Snapshot approved proposal and proposal not proposed yet
    await proposeTransactions(
      spyLogger,
      await createMonitoringParams(latestBlockNumber, { ogDiscovery: true, signer: executor, supportedBonds })
    );
    // It should propose
    sinon.assert.calledWithMatch(
      submitProposalsStub,
      sinon.match.any,
      sinon.match((arg) => arg.length == 1)
    );

    const tx = await ogModuleProxy.connect(proposer).proposeTransactions(transactions, toUtf8Bytes(explanationString));
    await tx.wait();
    const proposeBlockNumber = await getBlockNumberFromTx(tx);

    latestBlockNumber = await ethers.provider.getBlockNumber();

    // Case Snapshot approved proposal and proposal already proposed
    spyLogger = createNewLogger([new SpyTransport({}, { spy: sinon.spy() })]);
    await proposeTransactions(
      spyLogger,
      await createMonitoringParams(latestBlockNumber, { ogDiscovery: true, signer: executor, supportedBonds })
    );

    // It should not propose
    sinon.assert.calledWithMatch(
      submitProposalsStub,
      sinon.match.any,
      sinon.match((arg) => arg.length == 0)
    );

    const transactionProposedEvent = (
      await ogModuleProxy.queryFilter(
        optimisticGovernor.filters.TransactionsProposed(),
        proposeBlockNumber,
        proposeBlockNumber
      )
    )[0];

    await bondToken.mint(await disputer.getAddress(), await optimisticGovernor.getProposalBond());
    await bondToken.connect(disputer).approve(optimisticOracleV3.address, await optimisticGovernor.getProposalBond());

    const disputeTx = await optimisticOracleV3
      .connect(disputer)
      .disputeAssertion(transactionProposedEvent.args.assertionId, await disputer.getAddress());

    await disputeTx.wait();

    latestBlockNumber = await ethers.provider.getBlockNumber();

    // Case Snapshot approved proposal and proposal disputed and reproposeDisputed = false
    spyLogger = createNewLogger([new SpyTransport({}, { spy: sinon.spy() })]);
    const monitoringParams = await createMonitoringParams(latestBlockNumber, {
      ogDiscovery: true,
      signer: executor,
      supportedBonds,
    });
    await proposeTransactions(spyLogger, monitoringParams);
    // It should not propose with reproposeDisputed = false
    sinon.assert.calledWithMatch(
      submitProposalsStub,
      sinon.match.any,
      sinon.match((arg) => arg.length == 0)
    );

    // Case Snapshot approved proposal and proposal disputed and reproposeDisputed = true
    spyLogger = createNewLogger([new SpyTransport({}, { spy: sinon.spy() })]);
    monitoringParams.reproposeDisputed = true;
    await proposeTransactions(spyLogger, monitoringParams);
    // It should propose
    sinon.assert.calledWithMatch(
      submitProposalsStub,
      sinon.match.any,
      sinon.match((arg) => arg.length == 1)
    );
  });

  it("Automatically execute transactions", async function () {
    // Deploy a new OG module proxy and approve the proposal bond.
    const space = "test.eth";
    const { customAvatar, ogModuleProxy } = await deployOgModuleProxy({
      space,
      quorum: 0,
      votingPeriod: 0,
    });
    await bondToken.connect(proposer).approve(ogModuleProxy.address, await ogModuleProxy.getProposalBond());

    // Set supported bond settings.
    const supportedBonds: SupportedBonds = {};
    supportedBonds[bondToken.address] = (await ogModuleProxy.getProposalBond()).toString();

    // Fund the avatar
    await bondToken.mint(customAvatar.address, parseEther("500"));

    // Construct the transaction data for spending tokens from the avatar.
    const txnData1 = await bondToken.populateTransaction.transfer(await proposer.getAddress(), parseEther("250"));
    const txnData2 = await bondToken.populateTransaction.transfer(await random.getAddress(), parseEther("250"));

    if (!txnData1.data || !txnData2.data) throw new Error("Transaction data is undefined");

    const operation = 0; // 0 for call, 1 for delegatecall

    // Create the proposal with multiple transactions.
    const transactions = [
      { to: bondToken.address, operation, value: 0, data: txnData1.data },
      { to: bondToken.address, operation, value: 0, data: txnData2.data },
    ];

    const explanation = toUtf8Bytes("These transactions were approved by majority vote on Snapshot.");

    const proposeTx = await ogModuleProxy.connect(proposer).proposeTransactions(transactions, explanation);

    const proposeBlockNumber = await getBlockNumberFromTx(proposeTx);

    const transactionProposedEvent = (
      await ogModuleProxy.queryFilter(
        ogModuleProxy.filters.TransactionsProposed(),
        proposeBlockNumber,
        proposeBlockNumber
      )
    )[0];

    // Move time forward to the execution time. This also requires mining new block as the bot checks challenge window
    // based on block time.
    await timer.setCurrentTime(transactionProposedEvent.args.challengeWindowEnds);
    await hardhatTime.increaseTo(transactionProposedEvent.args.challengeWindowEnds);
    let latestBlockNumber = await ethers.provider.getBlockNumber();

    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await executeProposals(
      spyLogger,
      await createMonitoringParams(latestBlockNumber, { ogDiscovery: true, signer: executor, supportedBonds })
    );

    // Get the ProposalExecuted events (there should be only one).
    latestBlockNumber = await ethers.provider.getBlockNumber();
    const proposalExecutionEvents = await ogModuleProxy.queryFilter(
      ogModuleProxy.filters.ProposalExecuted(),
      proposeBlockNumber,
      latestBlockNumber
    );
    assert.equal(proposalExecutionEvents.length, 1);

    // When calling the bot module directly there should be only one log (index 0) with the execution caught by spy.
    assert.equal(spy.getCall(0).lastArg.at, "oSnapAutomation");
    assert.equal(spy.getCall(0).lastArg.message, "Submitted oSnap Execution 🏁");
    assert.equal(spyLogLevel(spy, 0), "info");
    assert.isTrue(spyLogIncludes(spy, 0, ogModuleProxy.address));
    assert.isTrue(spyLogIncludes(spy, 0, transactionProposedEvent.args.proposalHash));
    assert.isTrue(spyLogIncludes(spy, 0, space));
    assert.isTrue(spyLogIncludes(spy, 0, proposalExecutionEvents[0].transactionHash));
    assert.equal(spy.getCall(0).lastArg.notificationPath, "optimistic-governor");
  });
  it("Automatic execution not run for unsupported bonds", async function () {
    // Deploy a new OG module proxy and approve the proposal bond.
    const space = "test.eth";
    const { customAvatar, ogModuleProxy } = await deployOgModuleProxy({
      space,
      quorum: 0,
      votingPeriod: 0,
    });
    await bondToken.connect(proposer).approve(ogModuleProxy.address, await ogModuleProxy.getProposalBond());

    // Populate supported bond settings with correct token, but wrong amount and wrong token with correct amount.
    const supportedBonds: SupportedBonds = {};
    supportedBonds[bondToken.address] = (await ogModuleProxy.getProposalBond()).add(1).toString();
    supportedBonds[ethers.constants.AddressZero] = (await ogModuleProxy.getProposalBond()).toString();

    // Fund the avatar
    await bondToken.mint(customAvatar.address, parseEther("500"));

    // Construct the transaction data for spending tokens from the avatar.
    const txnData1 = await bondToken.populateTransaction.transfer(await proposer.getAddress(), parseEther("250"));
    const txnData2 = await bondToken.populateTransaction.transfer(await random.getAddress(), parseEther("250"));

    if (!txnData1.data || !txnData2.data) throw new Error("Transaction data is undefined");

    const operation = 0; // 0 for call, 1 for delegatecall

    // Create the proposal with multiple transactions.
    const transactions = [
      { to: bondToken.address, operation, value: 0, data: txnData1.data },
      { to: bondToken.address, operation, value: 0, data: txnData2.data },
    ];

    const explanation = toUtf8Bytes("These transactions were approved by majority vote on Snapshot.");

    const proposeTx = await ogModuleProxy.connect(proposer).proposeTransactions(transactions, explanation);

    const proposeBlockNumber = await getBlockNumberFromTx(proposeTx);

    const transactionProposedEvent = (
      await ogModuleProxy.queryFilter(
        ogModuleProxy.filters.TransactionsProposed(),
        proposeBlockNumber,
        proposeBlockNumber
      )
    )[0];

    // Move time forward to the execution time. This also requires mining new block as the bot checks challenge window
    // based on block time.
    await timer.setCurrentTime(transactionProposedEvent.args.challengeWindowEnds);
    await hardhatTime.increaseTo(transactionProposedEvent.args.challengeWindowEnds);
    let latestBlockNumber = await ethers.provider.getBlockNumber();

    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await executeProposals(
      spyLogger,
      await createMonitoringParams(latestBlockNumber, { ogDiscovery: true, signer: executor, supportedBonds })
    );

    // There should be no ProposalExecuted events.
    latestBlockNumber = await ethers.provider.getBlockNumber();
    const proposalExecutionEvents = await ogModuleProxy.queryFilter(
      ogModuleProxy.filters.ProposalExecuted(),
      proposeBlockNumber,
      latestBlockNumber
    );
    assert.equal(proposalExecutionEvents.length, 0);

    // There should be no logs caught by spy.
    assert.equal(spy.callCount, 0);
  });
  it("Automatic execution not run for unsupported rules", async function () {
    // Deploy a new OG module proxy with no parsed rules and approve the proposal bond.
    const { customAvatar, ogModuleProxy } = await deployOgModuleProxy();
    await bondToken.connect(proposer).approve(ogModuleProxy.address, await ogModuleProxy.getProposalBond());

    // Set supported bond settings.
    const supportedBonds: SupportedBonds = {};
    supportedBonds[bondToken.address] = (await ogModuleProxy.getProposalBond()).toString();

    // Fund the avatar
    await bondToken.mint(customAvatar.address, parseEther("500"));

    // Construct the transaction data for spending tokens from the avatar.
    const txnData1 = await bondToken.populateTransaction.transfer(await proposer.getAddress(), parseEther("250"));
    const txnData2 = await bondToken.populateTransaction.transfer(await random.getAddress(), parseEther("250"));

    if (!txnData1.data || !txnData2.data) throw new Error("Transaction data is undefined");

    const operation = 0; // 0 for call, 1 for delegatecall

    // Create the proposal with multiple transactions.
    const transactions = [
      { to: bondToken.address, operation, value: 0, data: txnData1.data },
      { to: bondToken.address, operation, value: 0, data: txnData2.data },
    ];

    const explanation = toUtf8Bytes("These transactions were approved by majority vote on Snapshot.");

    const proposeTx = await ogModuleProxy.connect(proposer).proposeTransactions(transactions, explanation);

    const proposeBlockNumber = await getBlockNumberFromTx(proposeTx);

    const transactionProposedEvent = (
      await ogModuleProxy.queryFilter(
        ogModuleProxy.filters.TransactionsProposed(),
        proposeBlockNumber,
        proposeBlockNumber
      )
    )[0];

    // Move time forward to the execution time. This also requires mining new block as the bot checks challenge window
    // based on block time.
    await timer.setCurrentTime(transactionProposedEvent.args.challengeWindowEnds);
    await hardhatTime.increaseTo(transactionProposedEvent.args.challengeWindowEnds);
    let latestBlockNumber = await ethers.provider.getBlockNumber();

    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await executeProposals(
      spyLogger,
      await createMonitoringParams(latestBlockNumber, { ogDiscovery: true, signer: executor, supportedBonds })
    );

    // There should be no ProposalExecuted events.
    latestBlockNumber = await ethers.provider.getBlockNumber();
    const proposalExecutionEvents = await ogModuleProxy.queryFilter(
      ogModuleProxy.filters.ProposalExecuted(),
      proposeBlockNumber,
      latestBlockNumber
    );
    assert.equal(proposalExecutionEvents.length, 0);

    // There should be no logs caught by spy.
    assert.equal(spy.callCount, 0);
  });
  it("Automatic execution not run before challenge period", async function () {
    // Deploy a new OG module proxy and approve the proposal bond.
    const space = "test.eth";
    const { customAvatar, ogModuleProxy } = await deployOgModuleProxy({
      space,
      quorum: 0,
      votingPeriod: 0,
    });
    await bondToken.connect(proposer).approve(ogModuleProxy.address, await ogModuleProxy.getProposalBond());

    // Set supported bond settings.
    const supportedBonds: SupportedBonds = {};
    supportedBonds[bondToken.address] = (await ogModuleProxy.getProposalBond()).toString();

    // Fund the avatar
    await bondToken.mint(customAvatar.address, parseEther("500"));

    // Construct the transaction data for spending tokens from the avatar.
    const txnData1 = await bondToken.populateTransaction.transfer(await proposer.getAddress(), parseEther("250"));
    const txnData2 = await bondToken.populateTransaction.transfer(await random.getAddress(), parseEther("250"));

    if (!txnData1.data || !txnData2.data) throw new Error("Transaction data is undefined");

    const operation = 0; // 0 for call, 1 for delegatecall

    // Create the proposal with multiple transactions.
    const transactions = [
      { to: bondToken.address, operation, value: 0, data: txnData1.data },
      { to: bondToken.address, operation, value: 0, data: txnData2.data },
    ];

    const explanation = toUtf8Bytes("These transactions were approved by majority vote on Snapshot.");

    const proposeTx = await ogModuleProxy.connect(proposer).proposeTransactions(transactions, explanation);

    const proposeBlockNumber = await getBlockNumberFromTx(proposeTx);

    const transactionProposedEvent = (
      await ogModuleProxy.queryFilter(
        ogModuleProxy.filters.TransactionsProposed(),
        proposeBlockNumber,
        proposeBlockNumber
      )
    )[0];

    // Move time forward 1 second before the challenge period. This also requires mining new block as the bot checks
    // challenge window based on block time.
    await timer.setCurrentTime(transactionProposedEvent.args.challengeWindowEnds.sub(1));
    await hardhatTime.increaseTo(transactionProposedEvent.args.challengeWindowEnds.sub(1));
    let latestBlockNumber = await ethers.provider.getBlockNumber();

    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await executeProposals(
      spyLogger,
      await createMonitoringParams(latestBlockNumber, { ogDiscovery: true, signer: executor, supportedBonds })
    );

    // There should be no ProposalExecuted events.
    latestBlockNumber = await ethers.provider.getBlockNumber();
    const proposalExecutionEvents = await ogModuleProxy.queryFilter(
      ogModuleProxy.filters.ProposalExecuted(),
      proposeBlockNumber,
      latestBlockNumber
    );
    assert.equal(proposalExecutionEvents.length, 0);

    // There should be no logs caught by spy.
    assert.equal(spy.callCount, 0);
  });
  it("Automatic execution not run for failing transactions", async function () {
    // Deploy a new OG module proxy and approve the proposal bond.
    const space = "test.eth";
    const { customAvatar, ogModuleProxy } = await deployOgModuleProxy({
      space,
      quorum: 0,
      votingPeriod: 0,
    });
    await bondToken.connect(proposer).approve(ogModuleProxy.address, await ogModuleProxy.getProposalBond());

    // Set supported bond settings.
    const supportedBonds: SupportedBonds = {};
    supportedBonds[bondToken.address] = (await ogModuleProxy.getProposalBond()).toString();

    // Don't fund the avatar up to the required amount. This should fail the execution simulation.
    await bondToken.mint(customAvatar.address, parseEther("499"));

    // Construct the transaction data for spending tokens from the avatar.
    const txnData1 = await bondToken.populateTransaction.transfer(await proposer.getAddress(), parseEther("250"));
    const txnData2 = await bondToken.populateTransaction.transfer(await random.getAddress(), parseEther("250"));

    if (!txnData1.data || !txnData2.data) throw new Error("Transaction data is undefined");

    const operation = 0; // 0 for call, 1 for delegatecall

    // Create the proposal with multiple transactions.
    const transactions = [
      { to: bondToken.address, operation, value: 0, data: txnData1.data },
      { to: bondToken.address, operation, value: 0, data: txnData2.data },
    ];

    const explanation = toUtf8Bytes("These transactions were approved by majority vote on Snapshot.");

    const proposeTx = await ogModuleProxy.connect(proposer).proposeTransactions(transactions, explanation);

    const proposeBlockNumber = await getBlockNumberFromTx(proposeTx);

    const transactionProposedEvent = (
      await ogModuleProxy.queryFilter(
        ogModuleProxy.filters.TransactionsProposed(),
        proposeBlockNumber,
        proposeBlockNumber
      )
    )[0];

    // Move time forward to the execution time. This also requires mining new block as the bot checks challenge window
    // based on block time.
    await timer.setCurrentTime(transactionProposedEvent.args.challengeWindowEnds);
    await hardhatTime.increaseTo(transactionProposedEvent.args.challengeWindowEnds);
    let latestBlockNumber = await ethers.provider.getBlockNumber();

    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await executeProposals(
      spyLogger,
      await createMonitoringParams(latestBlockNumber, { ogDiscovery: true, signer: executor, supportedBonds })
    );

    // There should be no ProposalExecuted events.
    latestBlockNumber = await ethers.provider.getBlockNumber();
    const proposalExecutionEvents = await ogModuleProxy.queryFilter(
      ogModuleProxy.filters.ProposalExecuted(),
      proposeBlockNumber,
      latestBlockNumber
    );
    assert.equal(proposalExecutionEvents.length, 0);

    // When calling the bot module directly there should be only one log (index 0) with the execution warn caught by spy.
    assert.equal(spy.getCall(0).lastArg.at, "oSnapAutomation");
    assert.equal(spy.getCall(0).lastArg.message, "Proposal execution would fail!");
    assert.equal(spyLogLevel(spy, 0), "info");
    assert.isTrue(spyLogIncludes(spy, 0, transactionProposedEvent.args.proposalHash));
    assert.isTrue(spyLogIncludes(spy, 0, ogModuleProxy.address));
    assert.isTrue(spyLogIncludes(spy, 0, space));
    assert.equal(spy.getCall(0).lastArg.notificationPath, "optimistic-governor");
  });
  it("Execution submission disabled", async function () {
    // Deploy a new OG module proxy and approve the proposal bond.
    const space = "test.eth";
    const { customAvatar, ogModuleProxy } = await deployOgModuleProxy({
      space,
      quorum: 0,
      votingPeriod: 0,
    });
    await bondToken.connect(proposer).approve(ogModuleProxy.address, await ogModuleProxy.getProposalBond());

    // Set supported bond settings.
    const supportedBonds: SupportedBonds = {};
    supportedBonds[bondToken.address] = (await ogModuleProxy.getProposalBond()).toString();

    // Fund the avatar
    await bondToken.mint(customAvatar.address, parseEther("500"));

    // Construct the transaction data for spending tokens from the avatar.
    const txnData1 = await bondToken.populateTransaction.transfer(await proposer.getAddress(), parseEther("250"));
    const txnData2 = await bondToken.populateTransaction.transfer(await random.getAddress(), parseEther("250"));

    if (!txnData1.data || !txnData2.data) throw new Error("Transaction data is undefined");

    const operation = 0; // 0 for call, 1 for delegatecall

    // Create the proposal with multiple transactions.
    const transactions = [
      { to: bondToken.address, operation, value: 0, data: txnData1.data },
      { to: bondToken.address, operation, value: 0, data: txnData2.data },
    ];

    const explanation = toUtf8Bytes("These transactions were approved by majority vote on Snapshot.");

    const proposeTx = await ogModuleProxy.connect(proposer).proposeTransactions(transactions, explanation);

    const proposeBlockNumber = await getBlockNumberFromTx(proposeTx);

    const transactionProposedEvent = (
      await ogModuleProxy.queryFilter(
        ogModuleProxy.filters.TransactionsProposed(),
        proposeBlockNumber,
        proposeBlockNumber
      )
    )[0];

    // Move time forward to the execution time. This also requires mining new block as the bot checks challenge window
    // based on block time.
    await timer.setCurrentTime(transactionProposedEvent.args.challengeWindowEnds);
    await hardhatTime.increaseTo(transactionProposedEvent.args.challengeWindowEnds);
    let latestBlockNumber = await ethers.provider.getBlockNumber();

    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    // Simulate execution of proposals without submitting transaction.
    await executeProposals(
      spyLogger,
      await createMonitoringParams(latestBlockNumber, {
        ogDiscovery: true,
        signer: executor,
        supportedBonds,
        submitAutomation: false,
      })
    );

    // There should be no ProposalExecuted events.
    latestBlockNumber = await ethers.provider.getBlockNumber();
    const proposalExecutionEvents = await ogModuleProxy.queryFilter(
      ogModuleProxy.filters.ProposalExecuted(),
      proposeBlockNumber,
      latestBlockNumber
    );
    assert.equal(proposalExecutionEvents.length, 0);

    // When calling the bot module directly there should be only one log (index 0) with the execution attempt caught by spy.
    assert.equal(spy.getCall(0).lastArg.at, "oSnapAutomation");
    assert.equal(spy.getCall(0).lastArg.message, "Execution transaction would succeed");
    assert.equal(spyLogLevel(spy, 0), "info");
    assert.isTrue(spyLogIncludes(spy, 0, ogModuleProxy.address));
    assert.isTrue(spyLogIncludes(spy, 0, transactionProposedEvent.args.proposalHash));
    assert.isTrue(spyLogIncludes(spy, 0, space));
    assert.equal(spy.getCall(0).lastArg.notificationPath, "optimistic-governor");
  });
  it("Execution disabled in blacklist", async function () {
    // Deploy a new OG module proxy and approve the proposal bond.
    const space = "test.eth";
    const { customAvatar, ogModuleProxy } = await deployOgModuleProxy({
      space,
      quorum: 0,
      votingPeriod: 0,
    });
    await bondToken.connect(proposer).approve(ogModuleProxy.address, await ogModuleProxy.getProposalBond());

    // Set supported bond settings.
    const supportedBonds: SupportedBonds = {};
    supportedBonds[bondToken.address] = (await ogModuleProxy.getProposalBond()).toString();

    // Fund the avatar
    await bondToken.mint(customAvatar.address, parseEther("500"));

    // Construct the transaction data for spending tokens from the avatar.
    const txnData1 = await bondToken.populateTransaction.transfer(await proposer.getAddress(), parseEther("250"));
    const txnData2 = await bondToken.populateTransaction.transfer(await random.getAddress(), parseEther("250"));

    if (!txnData1.data || !txnData2.data) throw new Error("Transaction data is undefined");

    const operation = 0; // 0 for call, 1 for delegatecall

    // Create the proposal with multiple transactions.
    const transactions = [
      { to: bondToken.address, operation, value: 0, data: txnData1.data },
      { to: bondToken.address, operation, value: 0, data: txnData2.data },
    ];

    const explanation = toUtf8Bytes("These transactions were approved by majority vote on Snapshot.");

    const proposeTx = await ogModuleProxy.connect(proposer).proposeTransactions(transactions, explanation);

    const proposeBlockNumber = await getBlockNumberFromTx(proposeTx);

    const transactionProposedEvent = (
      await ogModuleProxy.queryFilter(
        ogModuleProxy.filters.TransactionsProposed(),
        proposeBlockNumber,
        proposeBlockNumber
      )
    )[0];

    // Move time forward to the execution time. This also requires mining new block as the bot checks challenge window
    // based on block time.
    await timer.setCurrentTime(transactionProposedEvent.args.challengeWindowEnds);
    await hardhatTime.increaseTo(transactionProposedEvent.args.challengeWindowEnds);
    let latestBlockNumber = await ethers.provider.getBlockNumber();

    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    // Simulate execution of proposals by including current proposal's assertionId in the blacklist.
    await executeProposals(
      spyLogger,
      await createMonitoringParams(latestBlockNumber, {
        ogDiscovery: true,
        signer: executor,
        supportedBonds,
        submitAutomation: true,
        assertionBlacklist: [transactionProposedEvent.args.assertionId],
      })
    );

    // There should be no ProposalExecuted events.
    latestBlockNumber = await ethers.provider.getBlockNumber();
    const proposalExecutionEvents = await ogModuleProxy.queryFilter(
      ogModuleProxy.filters.ProposalExecuted(),
      proposeBlockNumber,
      latestBlockNumber
    );
    assert.equal(proposalExecutionEvents.length, 0);

    // There should be no logs caught by spy.
    assert.equal(spy.callCount, 0);
  });
  it("Parse rules, space with no trailing slash", async function () {
    const space = "test.eth";
    const quorum = 10;
    const votingPeriod = 3600;

    // Deploy contract only to reuse standard rules constructor.
    const { ogModuleProxy } = await deployOgModuleProxy({ space, quorum, votingPeriod });
    const rules = await ogModuleProxy.rules();

    // Check parsed rules.
    const parsedRules = parseRules(rules);
    assert.equal(parsedRules?.space, space);
    assert.equal(parsedRules?.quorum, quorum);
    assert.equal(parsedRules?.votingPeriod, votingPeriod);
  });
  it("Parse rules, space with trailing slash", async function () {
    const space = "test.eth";
    const quorum = 10;
    const votingPeriod = 3600;

    // Deploy contract only to reuse standard rules constructor.
    const { ogModuleProxy } = await deployOgModuleProxy({ space: space + "/", quorum, votingPeriod });
    const rules = await ogModuleProxy.rules();

    // Check parsed rules.
    const parsedRules = parseRules(rules);
    assert.equal(parsedRules?.space, space);
    assert.equal(parsedRules?.quorum, quorum);
    assert.equal(parsedRules?.votingPeriod, votingPeriod);
  });
});
