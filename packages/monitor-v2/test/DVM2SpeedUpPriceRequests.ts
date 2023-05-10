import type { Provider } from "@ethersproject/abstract-provider";
import "@nomiclabs/hardhat-ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { RegistryRolesEnum } from "@uma/common";
import {
  FinderEthers,
  IdentifierWhitelistEthers,
  OracleSpokeEthers,
  RegistryEthers,
  VotingTokenEthers,
  VotingV2Ethers,
  getAbi,
} from "@uma/contracts-node";
import { assert } from "chai";
import { BigNumber, BytesLike, utils } from "ethers";
import hre from "hardhat";
import sinon from "sinon";
import { resolvePrices } from "../src/price-publisher/ResolvePrices";
import { BotModes, MonitoringParams } from "../src/price-publisher/common";
import { dvm2Fixture } from "./fixtures/DVM2.Fixture";
import { umaEcosystemFixture } from "./fixtures/UmaEcosystem.Fixture";
import {
  Signer,
  formatBytes32String,
  getContractFactory,
  moveToNextPhase,
  moveToNextRound,
  toUtf8Bytes,
} from "./utils";

import { SpyTransport, createNewLogger, spyLogIncludes, spyLogLevel } from "@uma/financial-templates-lib";
import { OptimismChildMessenger } from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers";
import { ArbitrumParentMessenger, OracleSpoke } from "@uma/contracts-frontend/dist/typechain/core/ethers";

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

describe("DVM2 Price Resolver", function () {
  let votingToken: VotingTokenEthers;
  let votingV2: VotingV2Ethers;
  let registry: RegistryEthers;
  let deployer: Signer;
  let staker: Signer;
  let registeredContract: Signer;
  let parentMessenger: Signer;
  let deployerAddress: string;
  let stakerAddress: string;
  let registeredContractAddress: string;
  let oracleSpokeOptimism: OracleSpokeEthers;
  let oracleSpokeArbitrum: OracleSpokeEthers;
  let finder: FinderEthers;
  let optimismChildMessengerMock: any;
  let arbitrumChildMessengerMock: any;
  let polygonChildMessengerMock: any;

  const testAncillaryData = toUtf8Bytes(`q:"Really hard question, maybe 100, maybe 90?"`);
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
    [deployer, staker, registeredContract, parentMessenger] = (await ethers.getSigners()) as Signer[];
    deployerAddress = await deployer.getAddress();
    stakerAddress = await staker.getAddress();
    registeredContractAddress = await registeredContract.getAddress();

    // Get contract instances.
    const umaEcosystemContracts = await umaEcosystemFixture();
    votingToken = umaEcosystemContracts.votingToken;
    registry = umaEcosystemContracts.registry;
    const dvm2Contracts = await dvm2Fixture();
    votingV2 = dvm2Contracts.votingV2;
    finder = umaEcosystemContracts.finder;

    // Register contract with Registry.
    await (await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, deployerAddress)).wait();
    await (await registry.registerContract([], registeredContractAddress)).wait();

    // Add identifier to IdentifierWhitelist.
    await (umaEcosystemContracts.identifierWhitelist as IdentifierWhitelistEthers).addSupportedIdentifier(
      testIdentifier
    );

    optimismChildMessengerMock = await hre.waffle.deployMockContract(deployer, getAbi("Optimism_ChildMessenger"));
    arbitrumChildMessengerMock = await hre.waffle.deployMockContract(deployer, getAbi("Arbitrum_ChildMessenger"));
    polygonChildMessengerMock = await hre.waffle.deployMockContract(deployer, getAbi("Polygon_ChildMessenger"));

    oracleSpokeOptimism = (await (await getContractFactory("OracleSpoke", deployer)).deploy(
      finder.address
    )) as OracleSpokeEthers;
    oracleSpokeArbitrum = (await (await getContractFactory("OracleSpoke", deployer)).deploy(
      finder.address
    )) as OracleSpokeEthers;

    // Fund staker and stake tokens.
    const TEN_MILLION = ethers.utils.parseEther("10000000");
    await (await votingToken.addMinter(await deployer.getAddress())).wait();
    await (await votingToken.mint(await stakerAddress, TEN_MILLION)).wait();
    await (await votingToken.connect(staker).approve(votingV2.address, TEN_MILLION)).wait();
    await (await votingV2.connect(staker).stake(TEN_MILLION)).wait();
  });

  it("Optimism", async function () {
    await finder.changeImplementationAddress(formatBytes32String("ChildMessenger"), optimismChildMessengerMock.address);
    await optimismChildMessengerMock.mock.sendMessageToParent.returns();

    await oracleSpokeOptimism
      .connect(registeredContract)
      ["requestPrice(bytes32,uint256,bytes)"](testIdentifier, testRequestTime, testAncillaryData);
  });

  it("Arbitrum", async function () {
    await finder.changeImplementationAddress(formatBytes32String("ChildMessenger"), arbitrumChildMessengerMock.address);
    await arbitrumChildMessengerMock.mock.sendMessageToParent.returns();

    await oracleSpokeArbitrum
      .connect(registeredContract)
      ["requestPrice(bytes32,uint256,bytes)"](testIdentifier, testRequestTime, testAncillaryData);
  });

  it("Polygon", async function () {
    await finder.changeImplementationAddress(formatBytes32String("ChildMessenger"), arbitrumChildMessengerMock.address);
    await arbitrumChildMessengerMock.mock.sendMessageToParent.returns();

    await oracleSpokeArbitrum
      .connect(registeredContract)
      ["requestPrice(bytes32,uint256,bytes)"](testIdentifier, testRequestTime, testAncillaryData);
  });
});
