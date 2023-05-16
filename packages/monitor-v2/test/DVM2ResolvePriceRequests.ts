import type { Provider } from "@ethersproject/abstract-provider";
import "@nomiclabs/hardhat-ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { RegistryRolesEnum } from "@uma/common";
import { IdentifierWhitelistEthers, RegistryEthers, VotingTokenEthers, VotingV2Ethers } from "@uma/contracts-node";
import { assert } from "chai";
import { BigNumber, BytesLike, utils } from "ethers";
import hre from "hardhat";
import sinon from "sinon";
import { resolvePrices } from "../src/price-publisher/ResolvePrices";
import { BotModes, MonitoringParams } from "../src/price-publisher/common";
import { dvm2Fixture } from "./fixtures/DVM2.Fixture";
import { umaEcosystemFixture } from "./fixtures/UmaEcosystem.Fixture";
import { Signer, formatBytes32String, moveToNextPhase, moveToNextRound, toUtf8Bytes } from "./utils";

import { SpyTransport, createNewLogger, spyLogIncludes, spyLogLevel } from "@uma/financial-templates-lib";

const ethers = hre.ethers;

// Create monitoring params for single block to pass to monitor modules.
const createMonitoringParams = async (): Promise<MonitoringParams> => {
  // get chain id
  const chainId = await hre.ethers.provider.getNetwork().then((network) => network.chainId);
  // get hardhat signer
  const [signer] = await ethers.getSigners();
  // Bot modes are not used as we are calling monitor modules directly.
  const botModes: BotModes = {
    publishPricesEnabled: true,
    resolvePricesEnabled: true,
  };
  return {
    chainId: chainId,
    provider: ethers.provider as Provider,
    pollingDelay: 0,
    botModes,
    signer,
    maxBlockLookBack: 1000,
    blockLookback: 1000,
  };
};

describe("DVM2 Price Resolver", function () {
  let votingToken: VotingTokenEthers;
  let votingV2: VotingV2Ethers;
  let registry: RegistryEthers;
  let deployer: Signer;
  let staker: Signer;
  let registeredContract: Signer;
  let deployerAddress: string;
  let stakerAddress: string;
  let registeredContractAddress: string;

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
    [deployer, staker, registeredContract] = (await ethers.getSigners()) as Signer[];
    deployerAddress = await deployer.getAddress();
    stakerAddress = await staker.getAddress();
    registeredContractAddress = await registeredContract.getAddress();

    // Get contract instances.
    const umaEcosystemContracts = await umaEcosystemFixture();
    votingToken = umaEcosystemContracts.votingToken;
    registry = umaEcosystemContracts.registry;
    const dvm2Contracts = await dvm2Fixture();
    votingV2 = dvm2Contracts.votingV2;

    // Register contract with Registry.
    await (await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, deployerAddress)).wait();
    await (await registry.registerContract([], registeredContractAddress)).wait();

    // Add identifier to IdentifierWhitelist.
    await (umaEcosystemContracts.identifierWhitelist as IdentifierWhitelistEthers).addSupportedIdentifier(
      testIdentifier
    );

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
    ancillaryData: BytesLike,
    autoResolve = true
  ) => {
    await (
      await votingV2.connect(registeredContract)["requestPrice(bytes32,uint256,bytes)"](identifier, time, ancillaryData)
    ).wait();

    await moveToNextRound(votingV2);

    await commitAndReveal(voter as SignerWithAddress, voteValue, time, identifier, ancillaryData);

    await moveToNextRound(votingV2);

    if (autoResolve) await (await votingV2.updateTrackers(stakerAddress)).wait();
  };

  it("Price request to resolve", async function () {
    await requestVoteAndResolve(
      staker,
      ethers.utils.parseEther("1"),
      testRequestTime,
      testIdentifier,
      testAncillaryData,
      false
    );

    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);

    await resolvePrices(spyLogger, await createMonitoringParams());

    assert.equal(spy.getCall(0).lastArg.at, "PricePublisher");
    assert.equal(spy.getCall(0).lastArg.message, "Price Resolved ✅");
    assert.equal(spyLogLevel(spy, 0), "warn");
    assert.isTrue(spyLogIncludes(spy, 0, utils.parseBytes32String(testIdentifier)));
    assert.isTrue(spy.getCall(0).lastArg.mrkdwn.includes(ethers.utils.toUtf8String(testAncillaryData)));
    assert.isTrue(spyLogIncludes(spy, 0, testRequestTime.toString()));
    assert.equal(spy.getCall(0).lastArg.notificationPath, "price-publisher");
  });

  it("Price request already resolved", async function () {
    await requestVoteAndResolve(
      staker,
      ethers.utils.parseEther("1"),
      testRequestTime,
      testIdentifier,
      testAncillaryData
    );

    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);

    await resolvePrices(spyLogger, await createMonitoringParams());

    assert.equal(spy.callCount, 0);
  });
});
