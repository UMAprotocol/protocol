import {
  //   EmergencyProposerEthers,
  //   GovernorV2Ethers,
  ProposerV2Ethers,
  VotingTokenEthers,
  VotingV2Ethers,
} from "@uma/contracts-node";
import { createNewLogger, spyLogIncludes, spyLogLevel, SpyTransport } from "@uma/financial-templates-lib";
import { assert } from "chai";
import sinon from "sinon";
import { governanceProposalBond } from "./constants";
import { getBlockNumberFromTx, hre, parseBytes32String, parseUnits, Provider, Signer, toUtf8Bytes } from "./utils";
import { dvm2Fixture } from "./fixtures/DVM2.Fixture";
import { umaEcosystemFixture } from "./fixtures/UmaEcosystem.Fixture";
import { MonitoringParams, BotModes } from "../src/monitor-dvm/common";
import { monitorGovernance } from "../src/monitor-dvm/MonitorGovernance";
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

describe("DMVMonitor", function () {
  let votingToken: VotingTokenEthers;
  let votingV2: VotingV2Ethers;
  // let governorV2: GovernorV2Ethers;
  let proposerV2: ProposerV2Ethers;
  // let emergencyProposer: EmergencyProposerEthers;
  let staker: Signer;
  let proposer: Signer;
  let stakerAddress: string;
  let proposerAddress: string;
  beforeEach(async function () {
    // Signer from ethers and hardhat-ethers are not version compatible, thus, we cannot use the SignerWithAddress.
    [, staker, proposer] = (await ethers.getSigners()) as Signer[];
    stakerAddress = await staker.getAddress();
    proposerAddress = await proposer.getAddress();

    // Get contract instances.
    votingToken = (await umaEcosystemFixture()).votingToken;
    const parentFixture = await dvm2Fixture();
    votingV2 = parentFixture.votingV2;
    // governorV2 = parentFixture.governorV2;
    proposerV2 = parentFixture.proposerV2;
    // emergencyProposer = parentFixture.emergencyProposer;
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
});
