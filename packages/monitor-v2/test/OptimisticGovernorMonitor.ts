import { calculateProxyAddress } from "@gnosis.pm/zodiac";
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
import { BotModes, MonitoringParams } from "../src/monitor-og/common";
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
import { optimisticGovernorFixture } from "./fixtures/OptimisticGovernor.Fixture";
import { umaEcosystemFixture } from "./fixtures/UmaEcosystem.Fixture";
import {
  formatBytes32String,
  getBlockNumberFromTx,
  hre,
  parseEther,
  Provider,
  Signer,
  toUtf8Bytes,
  toUtf8String,
} from "./utils";
import { getContractInstanceWithProvider } from "../src/utils/contracts";

const ethers = hre.ethers;

interface OGModuleProxyDeployment {
  ogModuleProxy: OptimisticGovernorEthers;
  proxyCreationTx: TransactionResponse;
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
  let timer: TimerEthers;

  // Create monitoring params for single block to pass to monitor modules.
  const createMonitoringParams = async (blockNumber: number): Promise<MonitoringParams> => {
    // Bot modes are not used as we are calling monitor modules directly.
    const botModes: BotModes = {
      transactionsProposedEnabled: false,
      transactionsExecutedEnabled: false,
      proposalExecutedEnabled: false,
      proposalDeletedEnabled: false,
      setCollateralAndBondEnabled: false,
      setRulesEnabled: false,
      setLivenessEnabled: false,
      setIdentifierEnabled: false,
      setEscalationManagerEnabled: false,
      proxyDeployedEnabled: false,
    };
    return {
      ogAddresses: [optimisticGovernor.address],
      moduleProxyFactoryAddresses: [moduleProxyFactory.address],
      ogMasterCopyAddresses: [optimisticGovernor.address],
      provider: ethers.provider as Provider,
      chainId: (await ethers.provider.getNetwork()).chainId,
      blockRange: { start: blockNumber, end: blockNumber },
      pollingDelay: 0,
      botModes,
    };
  };

  const deployOgModuleProxy = async (): Promise<OGModuleProxyDeployment> => {
    // Use the same parameters as mastercopy, except for the owner and rules.
    const initializerParams = ethers.utils.defaultAbiCoder.encode(
      ["address", "address", "uint256", "string", "bytes32", "uint64"],
      [
        avatar.address,
        await optimisticGovernor.collateral(),
        await optimisticGovernor.bondAmount(),
        "test proxy rules",
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
    return { ogModuleProxy, proxyCreationTx };
  };

  beforeEach(async function () {
    // Signer from ethers and hardhat-ethers are not version compatible, thus, we cannot use the SignerWithAddress.
    [deployer, random, proposer, disputer] = (await ethers.getSigners()) as Signer[];

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
    assert.equal(spy.getCall(0).lastArg.message, "Transactions Proposed 📝");
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
    const { ogModuleProxy, proxyCreationTx } = await deployOgModuleProxy();
    const proxyDeployBlockNumber = await getBlockNumberFromTx(proxyCreationTx);

    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorProxyDeployments(spyLogger, await createMonitoringParams(proxyDeployBlockNumber));

    assert.equal(spy.getCall(0).lastArg.at, "OptimisticGovernorMonitor");
    assert.equal(spy.getCall(0).lastArg.message, "Optimistic Governor Deployed 📝");
    assert.isTrue(spyLogIncludes(spy, 0, ogModuleProxy.address));
    assert.isTrue(spyLogIncludes(spy, 0, avatar.address));
    assert.isTrue(spyLogIncludes(spy, 0, optimisticGovernor.address));
    assert.isTrue(spyLogIncludes(spy, 0, proxyCreationTx.hash));
    assert.equal(spyLogLevel(spy, 0), "warn");
    assert.equal(spy.getCall(0).lastArg.notificationPath, "optimistic-governor");
  });
});
