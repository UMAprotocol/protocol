import {
  EmergencyProposerEthers,
  GovernorV2Ethers,
  IdentifierWhitelistEthers,
  ProposerV2Ethers,
  RegistryEthers,
  VotingTokenEthers,
  VotingV2Ethers,
} from "@uma/contracts-node";
import { createNewLogger, spyLogIncludes, spyLogLevel, SpyTransport } from "@uma/financial-templates-lib";
import { assert } from "chai";
import sinon from "sinon";
import { emergencyQuorum, governanceProposalBond, maxRolls, minimumWaitTime, phaseLength } from "./constants";
import {
  formatBytes32String,
  getBlockNumberFromTx,
  hardhatTime,
  hre,
  parseBytes32String,
  parseUnits,
  Provider,
  Signer,
  toUtf8Bytes,
  toUtf8String,
} from "./utils";
import { dvm2Fixture } from "./fixtures/DVM2.Fixture";
import { umaEcosystemFixture } from "./fixtures/UmaEcosystem.Fixture";
import { MonitoringParams, BotModes } from "../src/monitor-dvm/common";
import { monitorDeletion } from "../src/monitor-dvm/MonitorDeletion";
import { monitorEmergency } from "../src/monitor-dvm/MonitorEmergency";
import { monitorGovernance } from "../src/monitor-dvm/MonitorGovernance";
import { monitorGovernorTransfers } from "../src/monitor-dvm/MonitorGovernorTransfers";
import { monitorMints } from "../src/monitor-dvm/MonitorMints";
import { monitorRolled } from "../src/monitor-dvm/MonitorRolled";
import { monitorStakes } from "../src/monitor-dvm/MonitorStakes";
import { monitorUnstakes } from "../src/monitor-dvm/MonitorUnstakes";

const ethers = hre.ethers;

// Create default monitoring params for single block to pass to monitor modules.
const createMonitoringParams = async (blockNumber: number): Promise<MonitoringParams> => {
  // Bot modes are not used as we are calling monitor modules directly.
  const botModes: BotModes = {
    unstakesEnabled: false,
    stakesEnabled: false,
    governanceEnabled: false,
    deletionEnabled: false,
    emergencyEnabled: false,
    rolledEnabled: false,
    governorTransfersEnabled: false,
    mintsEnabled: false,
  };
  return {
    provider: ethers.provider as Provider,
    chainId: (await ethers.provider.getNetwork()).chainId,
    blockRange: { start: blockNumber, end: blockNumber },
    pollingDelay: 0,
    botModes,
    unstakeThreshold: parseUnits("0"),
    stakeThreshold: parseUnits("0"),
    governorTransfersThreshold: parseUnits("0"),
    mintsThreshold: parseUnits("0"),
  };
};

describe("DVMMonitor", function () {
  let votingToken: VotingTokenEthers;
  let votingV2: VotingV2Ethers;
  let governorV2: GovernorV2Ethers;
  let proposerV2: ProposerV2Ethers;
  let emergencyProposer: EmergencyProposerEthers;
  let registry: RegistryEthers;
  let identifierWhitelist: IdentifierWhitelistEthers;
  let deployer: Signer;
  let staker: Signer;
  let proposer: Signer;
  let requester: Signer;
  let deployerAddress: string;
  let stakerAddress: string;
  let proposerAddress: string;
  let requesterAddress: string;
  beforeEach(async function () {
    // Signer from ethers and hardhat-ethers are not version compatible, thus, we cannot use the SignerWithAddress.
    [deployer, staker, proposer, requester] = (await ethers.getSigners()) as Signer[];
    deployerAddress = await deployer.getAddress();
    stakerAddress = await staker.getAddress();
    proposerAddress = await proposer.getAddress();
    requesterAddress = await requester.getAddress();

    // Get contract instances.
    const umaEcosystemContracts = await umaEcosystemFixture();
    votingToken = umaEcosystemContracts.votingToken;
    registry = umaEcosystemContracts.registry;
    identifierWhitelist = umaEcosystemContracts.identifierWhitelist;
    const dvm2Contracts = await dvm2Fixture();
    votingV2 = dvm2Contracts.votingV2;
    governorV2 = dvm2Contracts.governorV2;
    proposerV2 = dvm2Contracts.proposerV2;
    emergencyProposer = dvm2Contracts.emergencyProposer;
  });
  it("Monitor unstake", async function () {
    const stakeAmount = parseUnits("100");
    // Fund staker with voting tokens to stake.
    await votingToken.transfer(await stakerAddress, stakeAmount);
    await votingToken.connect(staker).approve(votingV2.address, stakeAmount);
    await votingV2.connect(staker).stake(stakeAmount);

    // Request unstake.
    const unstakeTx = await votingV2.connect(staker).requestUnstake(stakeAmount);
    const unstakeBlockNumber = await getBlockNumberFromTx(unstakeTx);

    // Call monitorUnstakes directly for the block when the unstake request was made.
    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorUnstakes(spyLogger, await createMonitoringParams(unstakeBlockNumber));

    // When calling monitoring module directly there should be only one log (index 0) with the unstake caught by spy.
    assert.equal(spy.getCall(0).lastArg.at, "DVMMonitor");
    assert.equal(spy.getCall(0).lastArg.message, "Large unstake requested 😟");
    assert.equal(spyLogLevel(spy, 0), "warn");
    assert.isTrue(spyLogIncludes(spy, 0, stakerAddress));
    assert.isTrue(spyLogIncludes(spy, 0, unstakeTx.hash));
  });
  it("Monitor unstake below threshold", async function () {
    const stakeAmount = parseUnits("100");
    // Fund staker with voting tokens to stake.
    await votingToken.transfer(await stakerAddress, stakeAmount);
    await votingToken.connect(staker).approve(votingV2.address, stakeAmount);
    await votingV2.connect(staker).stake(stakeAmount);

    // Request unstake.
    const unstakeTx = await votingV2.connect(staker).requestUnstake(stakeAmount);
    const unstakeBlockNumber = await getBlockNumberFromTx(unstakeTx);

    // Call monitorUnstakes directly for the block when the unstake request was made.
    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorUnstakes(spyLogger, {
      ...(await createMonitoringParams(unstakeBlockNumber)),
      unstakeThreshold: stakeAmount.add("1"),
    });

    // When calling monitoring module directly there should be no logs.
    assert.equal(spy.callCount, 0);
  });
  it("Monitor stake", async function () {
    const stakeAmount = parseUnits("100");
    // Fund staker with voting tokens to stake.
    await votingToken.transfer(await stakerAddress, stakeAmount);
    await votingToken.connect(staker).approve(votingV2.address, stakeAmount);
    const stakeTx = await votingV2.connect(staker).stake(stakeAmount);
    const stakeBlockNumber = await getBlockNumberFromTx(stakeTx);

    // Call monitorStakes directly for the block when the stake was made.
    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorStakes(spyLogger, await createMonitoringParams(stakeBlockNumber));

    // When calling monitoring module directly there should be only one log (index 0) with the stake caught by spy.
    assert.equal(spy.getCall(0).lastArg.at, "DVMMonitor");
    assert.equal(spy.getCall(0).lastArg.message, "Large amount staked 🍖");
    assert.equal(spyLogLevel(spy, 0), "warn");
    assert.isTrue(spyLogIncludes(spy, 0, stakerAddress));
    assert.isTrue(spyLogIncludes(spy, 0, stakeTx.hash));
  });
  it("Monitor stake below threshold", async function () {
    const stakeAmount = parseUnits("100");
    // Fund staker with voting tokens to stake.
    await votingToken.transfer(await stakerAddress, stakeAmount);
    await votingToken.connect(staker).approve(votingV2.address, stakeAmount);
    const stakeTx = await votingV2.connect(staker).stake(stakeAmount);
    const stakeBlockNumber = await getBlockNumberFromTx(stakeTx);

    // Call monitorStakes directly for the block when the stake was made.
    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorStakes(spyLogger, {
      ...(await createMonitoringParams(stakeBlockNumber)),
      stakeThreshold: stakeAmount.add("1"),
    });

    // When calling monitoring module directly there should be no logs.
    assert.equal(spy.callCount, 0);
  });
  it("Monitor governance proposal", async function () {
    // Fund and approve proposal bond.
    await votingToken.transfer(await proposerAddress, governanceProposalBond);
    await votingToken.connect(proposer).approve(proposerV2.address, governanceProposalBond);

    // Create a proposal with one empty transaction.
    const transaction = { to: proposerAddress, value: 0, data: toUtf8Bytes("") };
    const proposalTx = await proposerV2.connect(proposer).propose([transaction], toUtf8Bytes(""));
    const proposalBlockNumber = await getBlockNumberFromTx(proposalTx);

    // Get admin identifier from the first RequestAdded event in the governance request transaction.
    const adminIdentifier = parseBytes32String(
      (await votingV2.queryFilter(votingV2.filters.RequestAdded(), proposalBlockNumber, proposalBlockNumber))[0].args
        .identifier
    );

    // Call monitorGovernance directly for the block when the proposal was made.
    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorGovernance(spyLogger, await createMonitoringParams(proposalBlockNumber));

    // When calling monitoring module directly there should be only one log (index 0) with the proposal caught by spy.
    assert.equal(spy.getCall(0).lastArg.at, "DVMMonitor");
    assert.equal(spy.getCall(0).lastArg.message, "New governance proposal created 📜");
    assert.equal(spyLogLevel(spy, 0), "warn");
    assert.isTrue(spyLogIncludes(spy, 0, adminIdentifier));
    assert.isTrue(spyLogIncludes(spy, 0, proposalTx.hash));
  });
  it("Monitor emergency proposal", async function () {
    // Fund and approve emergency proposal bond.
    await votingToken.transfer(await proposerAddress, emergencyQuorum);
    await votingToken.connect(proposer).approve(emergencyProposer.address, emergencyQuorum);

    // Create a emergency proposal with one empty transaction.
    const transaction = { to: proposerAddress, value: 0, data: toUtf8Bytes("") };
    const emergencyProposalTx = await emergencyProposer.connect(proposer).emergencyPropose([transaction]);
    const emergencyProposalBlockNumber = await getBlockNumberFromTx(emergencyProposalTx);

    // Get proposal id and proposer from the first EmergencyTransactionsProposed event in the proposal transaction.
    const { id, caller } = (
      await emergencyProposer.queryFilter(
        emergencyProposer.filters.EmergencyTransactionsProposed(),
        emergencyProposalBlockNumber,
        emergencyProposalBlockNumber
      )
    )[0].args;

    // Call monitorEmergency directly for the block when the emergency proposal was made.
    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorEmergency(spyLogger, await createMonitoringParams(emergencyProposalBlockNumber));

    // When calling monitoring module directly there should be only one log (index 0) with the proposal caught by spy.
    assert.equal(spy.getCall(0).lastArg.at, "DVMMonitor");
    assert.equal(spy.getCall(0).lastArg.message, "New emergency proposal created 🚨");
    assert.equal(spyLogLevel(spy, 0), "error");
    assert.isTrue(spyLogIncludes(spy, 0, caller));
    assert.isTrue(spyLogIncludes(spy, 0, "emergency proposal #" + id.toString()));
    assert.isTrue(spyLogIncludes(spy, 0, emergencyProposalTx.hash));
  });
  it("Monitor deleted request", async function () {
    const identifier = formatBytes32String("TEST_IDENTIFIER");
    const time = await votingV2.getCurrentTime();
    const ancillaryData = toUtf8Bytes("Test ancillary data");

    // Register requester and approve price identifier.
    await registry.addMember(1, deployerAddress);
    await registry.registerContract([], requesterAddress);
    await registry.removeMember(1, deployerAddress);
    await identifierWhitelist.addSupportedIdentifier(identifier);

    // Initiate request.
    await votingV2.connect(requester)["requestPrice(bytes32,uint256,bytes)"](identifier, time, ancillaryData);

    // Advance time past maxRolls.
    const endOfCurrentRound = await votingV2.getRoundEndTime(await votingV2.getCurrentRoundId());
    await hardhatTime.setNextBlockTimestamp(endOfCurrentRound.toNumber() + phaseLength * 2 * (maxRolls + 1));

    // Process resolvable price requests to triger deletion.
    const deletionTx = await votingV2.processResolvablePriceRequests();
    const deletionBlockNumber = await getBlockNumberFromTx(deletionTx);

    // Call monitorDeletion directly for the block when the deletion was triggered.
    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorDeletion(spyLogger, await createMonitoringParams(deletionBlockNumber));

    // When calling monitoring module directly there should be only one log (index 0) with the deletion caught by spy.
    assert.equal(spy.getCall(0).lastArg.at, "DVMMonitor");
    assert.equal(spy.getCall(0).lastArg.message, "Request deleted as spam 🔇");
    assert.equal(spyLogLevel(spy, 0), "error");
    assert.isTrue(spyLogIncludes(spy, 0, parseBytes32String(identifier)));
    assert.isTrue(spyLogIncludes(spy, 0, deletionTx.hash));
    assert.isTrue(spyLogIncludes(spy, 0, toUtf8String(ancillaryData)));
  });
  it("Monitor rolled request", async function () {
    const identifier = formatBytes32String("TEST_IDENTIFIER");
    const time = await votingV2.getCurrentTime();
    const ancillaryData = toUtf8Bytes("Test ancillary data");

    // Register requester and approve price identifier.
    await registry.addMember(1, deployerAddress);
    await registry.registerContract([], requesterAddress);
    await registry.removeMember(1, deployerAddress);
    await identifierWhitelist.addSupportedIdentifier(identifier);

    // Initiate request.
    await votingV2.connect(requester)["requestPrice(bytes32,uint256,bytes)"](identifier, time, ancillaryData);

    // Advance time one round past when the request was initially scheduled to be voted on.
    const endOfCurrentRound = await votingV2.getRoundEndTime(await votingV2.getCurrentRoundId());
    await hardhatTime.setNextBlockTimestamp(endOfCurrentRound.toNumber() + phaseLength * 2);

    // Process resolvable price requests to triger request rolling.
    const rolledTx = await votingV2.processResolvablePriceRequests();
    const rolledBlockNumber = await getBlockNumberFromTx(rolledTx);

    // Call monitorRolled directly for the block when the deletion was triggered.
    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorRolled(spyLogger, await createMonitoringParams(rolledBlockNumber));

    // When calling monitoring module directly there should be only one log (index 0) with the roll caught by spy.
    assert.equal(spy.getCall(0).lastArg.at, "DVMMonitor");
    assert.equal(spy.getCall(0).lastArg.message, "Rolled request 🎲");
    assert.equal(spyLogLevel(spy, 0), "error");
    assert.isTrue(spyLogIncludes(spy, 0, parseBytes32String(identifier)));
    assert.isTrue(spyLogIncludes(spy, 0, rolledTx.hash));
    assert.isTrue(spyLogIncludes(spy, 0, toUtf8String(ancillaryData)));
  });
  it("Monitor transfers from governor", async function () {
    // Fund the governor first.
    const transferAmount = parseUnits("100");
    await votingToken.transfer(governorV2.address, transferAmount);

    // Fund and approve emergency proposal bond.
    await votingToken.transfer(await proposerAddress, emergencyQuorum);
    await votingToken.connect(proposer).approve(emergencyProposer.address, emergencyQuorum);

    // Create emergency proposal to transfer funds from governor to proposer.
    const transaction = {
      to: votingToken.address,
      value: 0,
      data: votingToken.interface.encodeFunctionData("transfer", [proposerAddress, transferAmount]),
    };
    const emergencyProposalTx = await emergencyProposer.connect(proposer).emergencyPropose([transaction]);
    const emergencyProposalBlockNumber = await getBlockNumberFromTx(emergencyProposalTx);

    // Get proposal id from the first EmergencyTransactionsProposed event in the proposal transaction.
    const id = (
      await emergencyProposer.queryFilter(
        emergencyProposer.filters.EmergencyTransactionsProposed(),
        emergencyProposalBlockNumber,
        emergencyProposalBlockNumber
      )
    )[0].args.id;

    // Advance time past minimumWaitTime
    await hardhatTime.increase(minimumWaitTime);

    // Execute emergency proposal.
    const transferTx = await emergencyProposer.executeEmergencyProposal(id);
    const transferBlockNumber = await getBlockNumberFromTx(transferTx);

    // Call monitorGovernorTransfers directly for the block when the transfer was executed.
    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorGovernorTransfers(spyLogger, await createMonitoringParams(transferBlockNumber));

    // When calling monitoring module directly there should be only one log (index 0) with the transfer caught by spy.
    assert.equal(spy.getCall(0).lastArg.at, "DVMMonitor");
    assert.equal(spy.getCall(0).lastArg.message, "Large governor transfer 📤");
    assert.equal(spyLogLevel(spy, 0), "error");
    assert.isTrue(spyLogIncludes(spy, 0, proposerAddress));
    assert.isTrue(spyLogIncludes(spy, 0, transferTx.hash));
  });
  it("Monitor transfers from governor below threshold", async function () {
    // Fund the governor first.
    const transferAmount = parseUnits("100");
    await votingToken.transfer(governorV2.address, transferAmount);

    // Fund and approve emergency proposal bond.
    await votingToken.transfer(await proposerAddress, emergencyQuorum);
    await votingToken.connect(proposer).approve(emergencyProposer.address, emergencyQuorum);

    // Create emergency proposal to transfer funds from governor to proposer.
    const transaction = {
      to: votingToken.address,
      value: 0,
      data: votingToken.interface.encodeFunctionData("transfer", [proposerAddress, transferAmount]),
    };
    const emergencyProposalTx = await emergencyProposer.connect(proposer).emergencyPropose([transaction]);
    const emergencyProposalBlockNumber = await getBlockNumberFromTx(emergencyProposalTx);

    // Get proposal id from the first EmergencyTransactionsProposed event in the proposal transaction.
    const id = (
      await emergencyProposer.queryFilter(
        emergencyProposer.filters.EmergencyTransactionsProposed(),
        emergencyProposalBlockNumber,
        emergencyProposalBlockNumber
      )
    )[0].args.id;

    // Advance time past minimumWaitTime
    await hardhatTime.increase(minimumWaitTime);

    // Execute emergency proposal.
    const transferTx = await emergencyProposer.executeEmergencyProposal(id);
    const transferBlockNumber = await getBlockNumberFromTx(transferTx);

    // Call monitorGovernorTransfers directly for the block when the transfer was executed.
    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorGovernorTransfers(spyLogger, {
      ...(await createMonitoringParams(transferBlockNumber)),
      governorTransfersThreshold: transferAmount.add("1"),
    });

    // When calling monitoring module directly there should be no logs.
    assert.equal(spy.callCount, 0);
  });
  it("Monitor mint", async function () {
    // Mint tokens to deployer.
    const mintAmount = parseUnits("100");
    const mintTx = await votingToken.mint(deployerAddress, mintAmount);
    const mintBlockNumber = await getBlockNumberFromTx(mintTx);

    // Call monitorMints directly for the block when the mint was made.
    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorMints(spyLogger, await createMonitoringParams(mintBlockNumber));

    // When calling monitoring module directly there should be only one log (index 0) with the mint caught by spy.
    assert.equal(spy.getCall(0).lastArg.at, "DVMMonitor");
    assert.equal(spy.getCall(0).lastArg.message, "Large UMA minting 💸");
    assert.equal(spyLogLevel(spy, 0), "error");
    assert.isTrue(spyLogIncludes(spy, 0, deployerAddress));
    assert.isTrue(spyLogIncludes(spy, 0, mintTx.hash));
  });
  it("Monitor mint below threshold", async function () {
    // Mint tokens to deployer.
    const mintAmount = parseUnits("100");
    const mintTx = await votingToken.mint(deployerAddress, mintAmount);
    const mintBlockNumber = await getBlockNumberFromTx(mintTx);

    // Call monitorMints directly for the block when the mint was made.
    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorMints(spyLogger, {
      ...(await createMonitoringParams(mintBlockNumber)),
      mintsThreshold: mintAmount.add("1"),
    });

    // When calling monitoring module directly there should be no logs.
    assert.equal(spy.callCount, 0);
  });
});
