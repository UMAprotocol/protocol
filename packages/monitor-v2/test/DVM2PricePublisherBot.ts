import type { Provider } from "@ethersproject/abstract-provider";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { RegistryRolesEnum } from "@uma/common";
import {
  FxChildMockEthers,
  FxRootMockEthers,
  IdentifierWhitelistEthers,
  OracleChildTunnelEthers,
  OracleHubEthers,
  OracleMessengerMockEthers,
  OracleRootTunnelEthers,
  OracleRootTunnelMockEthers,
  OracleSpokeEthers,
  RegistryEthers,
  StateSyncMockEthers,
  VotingTokenEthers,
  VotingV2Ethers,
} from "@uma/contracts-node";
import hre from "hardhat";
import { BigNumber, BytesLike, utils } from "ethers";
import { BotModes, MonitoringParams } from "../src/bot-oo-v3/common";
import { dvm2Fixture } from "./fixtures/DVM2.Fixture";
import { umaEcosystemFixture } from "./fixtures/UmaEcosystem.Fixture";
import { formatBytes32String, getContractFactory, moveToNextPhase, moveToNextRound, Signer } from "./utils";
import { ArbitrumParentMessenger } from "@uma/contracts-frontend/dist/typechain/core/ethers";
import { ArbitrumInboxMock } from "@uma/contracts-frontend/dist/typechain/@across-protocol/contracts/ethers";

import { getAbi } from "@uma/contracts-node";

const { defaultAbiCoder } = utils;

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
    runFrequency: 60,
    botModes,
    signer,
  };
};

describe("DVM2 Price Publisher", function () {
  let votingToken: VotingTokenEthers;
  let votingV2: VotingV2Ethers;
  let oracleHub: OracleHubEthers;
  let oracleRootTunnel: OracleRootTunnelMockEthers;
  let oracleSpoke: OracleSpokeEthers;
  let arbitrumParentMessenger: ArbitrumParentMessenger;
  let messengerMock: OracleMessengerMockEthers;
  // let governorV2: GovernorV2Ethers;
  // let proposerV2: ProposerV2Ethers;
  // let emergencyProposer: EmergencyProposerEthers;
  let registry: RegistryEthers;
  let identifierWhitelist: IdentifierWhitelistEthers;
  let deployer: Signer;
  let staker: Signer;
  // let proposer: Signer;
  let registeredContract: Signer;
  let deployerAddress: string;
  let stakerAddress: string;
  // let proposerAddress: string;
  let registeredContractAddress: string;
  let chainId: number;
  let arbitrumBridgeMock;

  const testAncillaryData = ethers.utils.toUtf8Bytes(`q:"Really hard question, maybe 100, maybe 90?"`);
  const testIdentifier = formatBytes32String("NUMERICAL");
  const testRequestTime = 1234567890;

  const commitAndReveal = async (
    signer: SignerWithAddress,
    price: BigNumber,
    time: BigNumber,
    identifier: BytesLike,
    ancillaryData: BytesLike
  ): Promise<void> => {
    const salt = "123";
    const roundId = Number(await votingV2.getCurrentRoundId());

    const voteHash = ethers.utils.solidityKeccak256(
      ["uint", "uint", "address", "uint", "bytes", "uint", "bytes32"],
      [price, salt, signer.address, time, ancillaryData, roundId, identifier]
    );

    (await votingV2.connect(signer as Signer).commitVote(identifier, time, ancillaryData, voteHash)).wait();

    await moveToNextPhase(votingV2);

    await (await votingV2.connect(signer as Signer).revealVote(identifier, time, price, ancillaryData, salt)).wait();
  };

  beforeEach(async function () {
    // Signer from ethers and hardhat-ethers are not version compatible, thus, we cannot use the SignerWithAddress.
    chainId = (await ethers.provider.getNetwork()).chainId;
    [deployer, staker, registeredContract] = (await ethers.getSigners()) as Signer[];
    deployerAddress = await deployer.getAddress();
    stakerAddress = await staker.getAddress();
    registeredContractAddress = await registeredContract.getAddress();

    // Get contract instances.
    const umaEcosystemContracts = await umaEcosystemFixture();
    votingToken = umaEcosystemContracts.votingToken;
    registry = umaEcosystemContracts.registry;
    identifierWhitelist = umaEcosystemContracts.identifierWhitelist;
    const dvm2Contracts = await dvm2Fixture();
    votingV2 = dvm2Contracts.votingV2;
    // governorV2 = dvm2Contracts.governorV2;
    // proposerV2 = dvm2Contracts.proposerV2;
    // emergencyProposer = dvm2Contracts.emergencyProposer;

    // const crossChainContracts = await oracleCrossChainFixture();

    oracleHub = (await (await getContractFactory("OracleHub", deployer)).deploy(
      umaEcosystemContracts.finder.address,
      umaEcosystemContracts.votingToken.address
    )) as OracleHubEthers;

    oracleSpoke = (await (await getContractFactory("OracleSpoke", deployer)).deploy(
      umaEcosystemContracts.finder.address
    )) as OracleSpokeEthers;

    // const stateSync = (await (await getContractFactory("StateSyncMock", deployer)).deploy()) as StateSyncMockEthers;
    // const fxRoot = (await (await getContractFactory("FxRootMock", deployer)).deploy(
    //   stateSync.address
    // )) as FxRootMockEthers;
    // const fxChild = (await (await getContractFactory("FxChildMock", deployer)).deploy(
    //   await deployer.getAddress()
    // )) as FxChildMockEthers;

    // await (await fxChild.setFxRoot(fxRoot.address)).wait();
    // await (await fxRoot.setFxChild(fxChild.address)).wait();

    // const oracleChild = (await (await getContractFactory("OracleChildTunnel", deployer)).deploy(
    //   fxChild.address,
    //   umaEcosystemContracts.finder.address
    // )) as OracleChildTunnelEthers;

    oracleRootTunnel = (await (await getContractFactory("OracleRootTunnelMock", deployer)).deploy(
      await deployer.getAddress(),
      await deployer.getAddress(),
      umaEcosystemContracts.finder.address
    )) as OracleRootTunnelMockEthers;

    messengerMock = (await (
      await getContractFactory("OracleMessengerMock", deployer)
    ).deploy()) as OracleMessengerMockEthers;

    // Add test identifier to whitelist.
    await (await identifierWhitelist.addSupportedIdentifier(testIdentifier)).wait();

    // Register contract with Registry.
    await (await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, deployerAddress)).wait();
    await (await registry.registerContract([], registeredContractAddress)).wait();
    await (await registry.registerContract([], oracleHub.address)).wait();
    await (await registry.registerContract([], oracleRootTunnel.address)).wait();

    // Arbitrum parent messenger setup

    const TEST = "0x0000000000000000000000000000000000000001";

    arbitrumBridgeMock = await (await getContractFactory("Arbitrum_BridgeMock", deployer)).deploy();

    const arbitrumInboxMock = await hre.waffle.deployMockContract(deployer, getAbi("Arbitrum_InboxMock"));
    const arbitrumOutboxMock = await hre.waffle.deployMockContract(deployer, getAbi("Arbitrum_OutboxMock"));

    await arbitrumBridgeMock.setOutbox(arbitrumOutboxMock.address);
    await arbitrumInboxMock.mock.bridge.returns(arbitrumBridgeMock.address);
    await arbitrumOutboxMock.mock.l2ToL1Sender.returns(TEST);

    arbitrumParentMessenger = (await (await getContractFactory("Arbitrum_ParentMessenger", deployer)).deploy(
      arbitrumInboxMock.address,
      10
    )) as ArbitrumParentMessenger;

    await arbitrumParentMessenger.setChildMessenger(TEST);
    await arbitrumParentMessenger.setOracleHub(oracleHub.address);

    await (await oracleHub.setMessenger(10, arbitrumParentMessenger.address)).wait();
  });

  xit("Testing", async function () {
    const time = BigNumber.from("0");
    await (
      await votingV2
        .connect(registeredContract)
        ["requestPrice(bytes32,uint256,bytes)"](testIdentifier, time, testAncillaryData)
    ).wait();

    // Price request event
    const priceRequestFilter = votingV2.filters.RequestAdded(null, null, null, null, null);
    const priceRequestEvents = await votingV2.queryFilter(priceRequestFilter);

    await moveToNextRound(votingV2);

    await commitAndReveal(
      staker as SignerWithAddress,
      ethers.utils.parseEther("1"),
      time,
      testIdentifier,
      testAncillaryData
    );

    await moveToNextRound(votingV2);

    await (await votingV2.updateTrackers(stakerAddress)).wait();

    // Get reques resolved event.
    const requestResolvedFilter = votingV2.filters.RequestResolved(null, null, null, null, null);
    const requestResolvedEvents = await votingV2.queryFilter(requestResolvedFilter);

    console.log(requestResolvedEvents[0]);

    await (await oracleHub.publishPrice(chainId, testIdentifier, time, testAncillaryData)).wait();

    // Call monitorAssertions directly for the block when the assertion was made.
    // const spy = sinon.spy();
    // const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    // await settleAssertions(spyLogger, await createMonitoringParams());

    // // No logs should be generated as there are no assertions to settle.
    // assert.isNull(spy.getCall(0));

    // // move time forward to the execution time.
    // await hardhatTime.increase(defaultLiveness);
    // await settleAssertions(spyLogger, await createMonitoringParams());

    // // When calling monitoring module directly there should be only one log (index 0) with the assertion caught by spy.
    // assert.equal(spy.getCall(0).lastArg.at, "OOv3Bot");
    // assert.equal(spy.getCall(0).lastArg.message, "Assertion Settled ✅");
    // assert.equal(spyLogLevel(spy, 0), "warn");
    // assert.isTrue(spyLogIncludes(spy, 0, assertionMadeEvent.args.assertionId));
    // assert.isTrue(spyLogIncludes(spy, 0, toUtf8String(claim)));
    // assert.isTrue(spyLogIncludes(spy, 0, "Settlement Resolution: true"));
    // assert.equal(spy.getCall(0).lastArg.notificationPath, "optimistic-oracle");

    // spy.resetHistory();
    // await settleAssertions(spyLogger, await createMonitoringParams());
    // // There should be no logs as there are no assertions to settle.
    // assert.isNull(spy.getCall(0));
  });

  it("Message received arbitrum", async function () {
    const ancillaryDataStamp = await oracleSpoke.stampAncillaryData(testAncillaryData);

    const encodedData = defaultAbiCoder.encode(
      ["bytes32", "uint256", "bytes"],
      [testIdentifier, testRequestTime, ancillaryDataStamp]
    );

    await hre.network.provider.send("hardhat_setBalance", [
      arbitrumBridgeMock.address,
      ethers.utils.parseEther("10.0").toHexString(),
    ]);

    const bridgeSigner = (await ethers.getImpersonatedSigner(arbitrumBridgeMock.address)) as Signer;

    await arbitrumParentMessenger.connect(bridgeSigner).processMessageFromCrossChainChild(encodedData);

    const messagesReceivedFilter = arbitrumParentMessenger.filters.MessageReceivedFromChild(null, null, null);
    const messagesReceived = await arbitrumParentMessenger.queryFilter(messagesReceivedFilter);

    console.log(messagesReceived[0]);
  });

  it("Message received polygon", async function () {
    const ancillaryDataStamp = await oracleSpoke.stampAncillaryData(testAncillaryData);

    const encodedData = defaultAbiCoder.encode(
      ["bytes32", "uint256", "bytes"],
      [testIdentifier, testRequestTime, ancillaryDataStamp]
    );

    await oracleRootTunnel.processMessageFromChild(encodedData);
  });
});
