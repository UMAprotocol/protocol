/* eslint-disable no-unexpected-multiline */
import type { Provider } from "@ethersproject/abstract-provider";
import "@nomiclabs/hardhat-ethers";
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
import { BigNumber, utils } from "ethers";
import hre from "hardhat";
import sinon from "sinon";
import { speedUpPrices } from "../src/price-speed-up/SpeedUpPriceRequests";
import { BotModes, MonitoringParams } from "../src/price-speed-up/common";
import { dvm2Fixture } from "./fixtures/DVM2.Fixture";
import { umaEcosystemFixture } from "./fixtures/UmaEcosystem.Fixture";
import { Signer, formatBytes32String, getContractFactory, toUtf8Bytes } from "./utils";

import { addGlobalHardhatTestingAddress } from "@uma/common";
import { OracleHubEthers } from "@uma/contracts-node";
import { SpyTransport, createNewLogger, spyLogIncludes, spyLogLevel } from "@uma/financial-templates-lib";
import { StoreEthers } from "@uma/contracts-node";

const ethers = hre.ethers;

// Create monitoring params for single block to pass to monitor modules.
const createMonitoringParams = async (): Promise<MonitoringParams> => {
  // get chain id
  const chainId = await hre.ethers.provider.getNetwork().then((network) => network.chainId);
  // get hardhat signer
  const [signer] = await ethers.getSigners();
  // Bot modes are not used as we are calling monitor modules directly.
  const botModes: BotModes = {
    speedUpPricesEnabled: true,
  };
  return {
    chainId: chainId,
    l2ChainId: chainId,
    provider: ethers.provider as Provider,
    l2Provider: ethers.provider as Provider,
    pollingDelay: 0,
    botModes,
    signer,
    maxBlockLookBack: 1000,
    blockLookback: 1000,
  };
};

describe("DVM2 Price Speed up", function () {
  let votingToken: VotingTokenEthers;
  let votingV2: VotingV2Ethers;
  let registry: RegistryEthers;
  let deployer: Signer;
  let registeredContract: Signer;
  let store: StoreEthers;
  let deployerAddress: string;
  let registeredContractAddress: string;
  let oracleSpokeOptimism: OracleSpokeEthers;
  let oracleSpokeArbitrum: OracleSpokeEthers;
  let oracleHub: OracleHubEthers;
  let finder: FinderEthers;
  let optimismChildMessengerMock: any;
  let arbitrumChildMessengerMock: any;

  const testAncillaryData = toUtf8Bytes(`q:"Really hard question, maybe 100, maybe 90?"`);
  const testIdentifier = formatBytes32String("NUMERICAL");
  const testRequestTime = BigNumber.from("1234567890");

  beforeEach(async function () {
    // Signer from ethers and hardhat-ethers are not version compatible, thus, we cannot use the SignerWithAddress.
    [deployer, registeredContract] = (await ethers.getSigners()) as Signer[];
    deployerAddress = await deployer.getAddress();
    registeredContractAddress = await registeredContract.getAddress();

    // Get contract instances.
    const umaEcosystemContracts = await umaEcosystemFixture();
    votingToken = umaEcosystemContracts.votingToken;
    registry = umaEcosystemContracts.registry;
    const dvm2Contracts = await dvm2Fixture();
    votingV2 = dvm2Contracts.votingV2;
    finder = umaEcosystemContracts.finder;
    store = umaEcosystemContracts.store;

    // Add identifier to IdentifierWhitelist.
    await (umaEcosystemContracts.identifierWhitelist as IdentifierWhitelistEthers).addSupportedIdentifier(
      testIdentifier
    );

    optimismChildMessengerMock = await hre.waffle.deployMockContract(deployer, getAbi("Optimism_ChildMessenger"));
    arbitrumChildMessengerMock = await hre.waffle.deployMockContract(deployer, getAbi("Arbitrum_ChildMessenger"));

    oracleSpokeOptimism = (await (await getContractFactory("OracleSpoke", deployer)).deploy(
      finder.address
    )) as OracleSpokeEthers;
    oracleSpokeArbitrum = (await (await getContractFactory("OracleSpoke", deployer)).deploy(
      finder.address
    )) as OracleSpokeEthers;

    oracleHub = (await (await getContractFactory("OracleHub", deployer)).deploy(
      umaEcosystemContracts.finder.address,
      umaEcosystemContracts.votingToken.address
    )) as OracleHubEthers;

    addGlobalHardhatTestingAddress("OracleHub", oracleHub.address);
    addGlobalHardhatTestingAddress("VotingV2", votingV2.address);

    // Register contract with Registry.
    await (await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, deployerAddress)).wait();
    await (await registry.registerContract([], registeredContractAddress)).wait();
    await (await registry.registerContract([], oracleHub.address)).wait();

    // Fund staker and stake tokens.
    const TEN_MILLION = ethers.utils.parseEther("10000000");
    await (await votingToken.addMinter(await deployer.getAddress())).wait();
    await (await votingToken.mint(await deployer.getAddress(), TEN_MILLION)).wait();
  });

  it("Optimism speed up", async function () {
    await finder.changeImplementationAddress(formatBytes32String("ChildMessenger"), optimismChildMessengerMock.address);
    await optimismChildMessengerMock.mock.sendMessageToParent.returns();

    await oracleSpokeOptimism.connect(registeredContract)[
      // eslint-disable-next-line no-unexpected-multiline
      "requestPrice(bytes32,uint256,bytes)"
    ](testIdentifier, testRequestTime, testAncillaryData);

    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);

    addGlobalHardhatTestingAddress("OracleSpoke", oracleSpokeOptimism.address);
    await speedUpPrices(spyLogger, await createMonitoringParams());

    assert.equal(spy.getCall(0).lastArg.at, "PriceSpeedUp");
    assert.equal(spy.getCall(0).lastArg.message, "Price Request Sped Up ✅");
    assert.equal(spyLogLevel(spy, 0), "warn");
    assert.isTrue(spyLogIncludes(spy, 0, utils.parseBytes32String(testIdentifier)));
    assert.isTrue(spy.getCall(0).lastArg.mrkdwn.includes(ethers.utils.keccak256(testAncillaryData).slice(2)));
    assert.isTrue(spyLogIncludes(spy, 0, testRequestTime.toString()));
    assert.equal(spy.getCall(0).lastArg.notificationPath, "price-speed-up");
  });

  it("Optimism speed up already done", async function () {
    await finder.changeImplementationAddress(formatBytes32String("ChildMessenger"), optimismChildMessengerMock.address);
    await optimismChildMessengerMock.mock.sendMessageToParent.returns();

    const requestTxn = await oracleSpokeOptimism
      .connect(registeredContract)
      ["requestPrice(bytes32,uint256,bytes)"](testIdentifier, testRequestTime, testAncillaryData);

    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);

    addGlobalHardhatTestingAddress("OracleSpoke", oracleSpokeOptimism.address);

    const finalFee = await store.computeFinalFee(votingToken.address);
    await votingToken.approve(oracleHub.address, finalFee.rawValue);
    await (
      await oracleHub
        .connect(deployer)
        .requestPrice(
          testIdentifier,
          testRequestTime,
          await (oracleSpokeOptimism as OracleSpokeEthers).compressAncillaryData(
            testAncillaryData,
            await registeredContract.getAddress(),
            requestTxn.blockNumber
          )
        )
    ).wait();

    await speedUpPrices(spyLogger, await createMonitoringParams());

    assert.equal(spy.callCount, 0);
  });

  it("Arbitrum speed up", async function () {
    await finder.changeImplementationAddress(formatBytes32String("ChildMessenger"), arbitrumChildMessengerMock.address);
    await arbitrumChildMessengerMock.mock.sendMessageToParent.returns();

    await oracleSpokeArbitrum
      .connect(registeredContract)
      ["requestPrice(bytes32,uint256,bytes)"](testIdentifier, testRequestTime, testAncillaryData);

    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);

    addGlobalHardhatTestingAddress("OracleSpoke", oracleSpokeArbitrum.address);
    await speedUpPrices(spyLogger, await createMonitoringParams());

    assert.equal(spy.getCall(0).lastArg.at, "PriceSpeedUp");
    assert.equal(spy.getCall(0).lastArg.message, "Price Request Sped Up ✅");
    assert.equal(spyLogLevel(spy, 0), "warn");
    assert.isTrue(spyLogIncludes(spy, 0, utils.parseBytes32String(testIdentifier)));
    assert.isTrue(spy.getCall(0).lastArg.mrkdwn.includes(ethers.utils.keccak256(testAncillaryData).slice(2)));
    assert.isTrue(spyLogIncludes(spy, 0, testRequestTime.toString()));
    assert.equal(spy.getCall(0).lastArg.notificationPath, "price-speed-up");
  });
});
