import type { Provider } from "@ethersproject/abstract-provider";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { RegistryRolesEnum, addGlobalHardhatTestingAddress } from "@uma/common";
import { ArbitrumParentMessenger } from "@uma/contracts-frontend/dist/typechain/core/ethers";
import {
  IdentifierWhitelistEthers,
  OracleHubEthers,
  OracleRootTunnelMockEthers,
  OracleSpokeEthers,
  RegistryEthers,
  VotingTokenEthers,
  VotingV2Ethers,
} from "@uma/contracts-node";
import { assert } from "chai";
import { BigNumber, BytesLike, utils } from "ethers";
import hre from "hardhat";
import sinon from "sinon";
import { publishPrices } from "../src/price-publisher/PublishPrices";
import { BotModes, MonitoringParams } from "../src/price-publisher/common";
import { dvm2Fixture } from "./fixtures/DVM2.Fixture";
import { umaEcosystemFixture } from "./fixtures/UmaEcosystem.Fixture";
import { Signer, formatBytes32String, getContractFactory, moveToNextPhase, moveToNextRound } from "./utils";

import { getAbi } from "@uma/contracts-node";
import { SpyTransport, createNewLogger, spyLogIncludes, spyLogLevel } from "@uma/financial-templates-lib";
import { ARBITRUM_CHAIN_ID } from "../src/price-publisher/common";
import { tryHexToUtf8String } from "../src/utils/contracts";

const { defaultAbiCoder } = utils;

const ethers = hre.ethers;

// Create monitoring params for single block to pass to monitor modules.
const createMonitoringParams = async (): Promise<MonitoringParams> => {
  // get chain id
  const chainId = await hre.ethers.provider.getNetwork().then((network) => network.chainId);
  // get hardhat signer
  const [signer] = await ethers.getSigners();
  // Bot modes are not used as we are calling monitor modules directly.
  const botModes: BotModes = {
    publishPricesEnabled: false,
  };
  return {
    chainId: chainId,
    provider: ethers.provider as Provider,
    pollingDelay: 0,
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
  let registry: RegistryEthers;
  let identifierWhitelist: IdentifierWhitelistEthers;
  let deployer: Signer;
  let staker: Signer;
  let registeredContract: Signer;
  let deployerAddress: string;
  let stakerAddress: string;
  let registeredContractAddress: string;
  let arbitrumBridgeMock;

  const testAncillaryData = ethers.utils.toUtf8Bytes(`q:"Really hard question, maybe 100, maybe 90?"`);
  const testIdentifier = formatBytes32String("NUMERICAL");
  const testRequestTime = BigNumber.from("1234567890");

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
    await arbitrumInboxMock.mock.createRetryableTicketNoRefundAliasRewrite.returns(1);

    arbitrumParentMessenger = (await (await getContractFactory("Arbitrum_ParentMessenger", deployer)).deploy(
      arbitrumInboxMock.address,
      ARBITRUM_CHAIN_ID
    )) as ArbitrumParentMessenger;

    await arbitrumParentMessenger.setChildMessenger(TEST);
    await arbitrumParentMessenger.setOracleHub(oracleHub.address);

    await (await oracleHub.setMessenger(ARBITRUM_CHAIN_ID, arbitrumParentMessenger.address)).wait();

    addGlobalHardhatTestingAddress("Arbitrum_ParentMessenger", arbitrumParentMessenger.address);
    addGlobalHardhatTestingAddress("OracleHub", oracleHub.address);

    // Fund staker and stake tokens.
    const TEN_MILLION = ethers.utils.parseEther("10000000");
    await (await votingToken.addMinter(await deployer.getAddress())).wait();
    await (await votingToken.mint(await stakerAddress, TEN_MILLION)).wait();
    await (await votingToken.connect(staker).approve(votingV2.address, TEN_MILLION)).wait();
    await (await votingV2.connect(staker).stake(TEN_MILLION)).wait();
  });

  const requestVoteAndResolve = async (
    voter: Signer,
    voteValue: BigNumber,
    time: BigNumber,
    identifier: string,
    ancillaryData: string
  ) => {
    await (
      await votingV2.connect(registeredContract)["requestPrice(bytes32,uint256,bytes)"](identifier, time, ancillaryData)
    ).wait();

    await moveToNextRound(votingV2);

    await commitAndReveal(voter as SignerWithAddress, voteValue, time, identifier, ancillaryData);

    await moveToNextRound(votingV2);

    await (await votingV2.updateTrackers(stakerAddress)).wait();
  };

  it("Message received from Arbitrum to be published", async function () {
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

    await requestVoteAndResolve(
      staker,
      ethers.utils.parseEther("1"),
      testRequestTime,
      testIdentifier,
      ancillaryDataStamp
    );

    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);

    await publishPrices(spyLogger, await createMonitoringParams());

    assert.equal(spy.getCall(0).lastArg.at, "PricePublisher");
    assert.equal(spy.getCall(0).lastArg.message, "Price Published ✅");
    assert.equal(spyLogLevel(spy, 0), "warn");
    assert.isTrue(spyLogIncludes(spy, 0, utils.parseBytes32String(testIdentifier)));
    assert.isTrue(spy.getCall(0).lastArg.mrkdwn.includes(await tryHexToUtf8String(ancillaryDataStamp)));
    assert.isTrue(spyLogIncludes(spy, 0, testRequestTime.toString()));
    assert.equal(spy.getCall(0).lastArg.notificationPath, "price-publisher");
  });

  it("Message received from Arbitrum already published", async function () {
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

    await requestVoteAndResolve(
      staker,
      ethers.utils.parseEther("1"),
      testRequestTime,
      testIdentifier,
      ancillaryDataStamp
    );

    const arbitrumL1CallValue = await arbitrumParentMessenger.getL1CallValue();

    await (
      await oracleHub.publishPrice(ARBITRUM_CHAIN_ID, testIdentifier, testRequestTime, ancillaryDataStamp, {
        value: arbitrumL1CallValue,
      })
    ).wait();

    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);

    await publishPrices(spyLogger, await createMonitoringParams());

    // There should be no logs as there are no prices to publish.
    assert.isNull(spy.getCall(0));
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
