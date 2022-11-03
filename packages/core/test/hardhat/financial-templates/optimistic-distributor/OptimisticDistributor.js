const { assert } = require("chai");
const hre = require("hardhat");
const { web3, getContract, assertEventEmitted } = hre;
const { interfaceName, runDefaultFixture, TokenRolesEnum } = require("@uma/common");
const { utf8ToHex, hexToUtf8, padRight, toWei, toBN, randomHex } = web3.utils;

// Tested contracts
const OptimisticDistributor = getContract("OptimisticDistributor");

// Helper contracts
const Finder = getContract("Finder");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const AddressWhitelist = getContract("AddressWhitelist");
const OptimisticOracleV2 = getContract("OptimisticOracleV2");
const MockOracle = getContract("MockOracleAncillary");
const Timer = getContract("Timer");
const Store = getContract("Store");
const ERC20 = getContract("ExpandedERC20");

const maximumFundingPeriod = 24 * 60 * 60 * 365; // 1 year maximum allowed funding period.
const maximumProposerBond = toWei("1000000"); // 1M maximum allowed proposer bond.
const finalFee = toWei("100");
const identifier = utf8ToHex("TESTID");
const customAncillaryData = utf8ToHex("ABC123");
const zeroRawValue = { rawValue: "0" };
const rewardAmount = toWei("10000");
const bondAmount = toWei("500");
const proposalLiveness = 24 * 60 * 60; // 1 day period for disputing distribution proposal.
const fundingPeriod = 24 * 60 * 60; // 1 day period for posting additional rewards.
const ipfsHash = utf8ToHex("IPFS HASH");
const ancillaryBytesReserve = 512;
const minimumLiveness = 10 * 60; // 10 minutes
const maximumLiveness = 5200 * 7 * 24 * 60 * 60; // 5200 weeks

describe("OptimisticDistributor", async function () {
  let accounts, deployer, anyAddress, sponsor, proposer, disputer;

  let timer,
    finder,
    collateralWhitelist,
    store,
    identifierWhitelist,
    bondToken,
    mockOracle,
    optimisticDistributor,
    optimisticOracle,
    merkleDistributor,
    rewardToken,
    earliestProposalTimestamp,
    defaultRewardParameters;

  const mintAndApprove = async (token, owner, spender, amount, minter) => {
    await token.methods.mint(owner, amount).send({ from: minter });
    await token.methods.approve(spender, amount).send({ from: owner });
  };

  const createProposeRewards = async (rewardIndex) => {
    await optimisticDistributor.methods.createReward(...defaultRewardParameters).send({ from: sponsor });
    await advanceTime(fundingPeriod);
    const totalBond = toBN(bondAmount).add(toBN(finalFee)).toString();
    await mintAndApprove(bondToken, proposer, optimisticDistributor.options.address, totalBond, deployer);
    const merkleRoot = randomHex(32);
    const ancillaryData = utf8ToHex(hexToUtf8(customAncillaryData) + ",rewardIndex:" + rewardIndex);
    const proposalTimestamp = parseInt(await timer.methods.getCurrentTime().call());
    await optimisticDistributor.methods.proposeDistribution(rewardIndex, merkleRoot, ipfsHash).send({ from: proposer });
    return [totalBond, ancillaryData, proposalTimestamp, merkleRoot];
  };

  const advanceTime = async (timeIncrease) => {
    const currentTime = parseInt(await timer.methods.getCurrentTime().call());
    await timer.methods.setCurrentTime(currentTime + timeIncrease).send({ from: deployer });
  };

  const didContractRevertWith = async (promise, expectedMessage) => {
    try {
      await promise;
    } catch (error) {
      return !!error.message.match(/revert/) && !!error.message.match(new RegExp(expectedMessage));
    }
    return false;
  };

  const generateProposalId = (identifier, timestamp, ancillaryData) => {
    const dataAbiEncoded = web3.eth.abi.encodeParameters(
      ["bytes32", "uint256", "bytes"],
      [padRight(identifier, 64), timestamp, ancillaryData]
    );
    return web3.utils.soliditySha3(dataAbiEncoded);
  };

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [deployer, anyAddress, sponsor, proposer, disputer] = accounts;

    await runDefaultFixture(hre);

    timer = await Timer.deployed();
    finder = await Finder.deployed();
    collateralWhitelist = await AddressWhitelist.deployed();
    store = await Store.deployed();
    identifierWhitelist = await IdentifierWhitelist.deployed();
    optimisticOracle = await OptimisticOracleV2.deployed();

    // Deploy new MockOracle so that OptimisticOracle disputes can make price requests to it:
    mockOracle = await MockOracle.new(finder.options.address, timer.options.address).send({ from: deployer });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.options.address)
      .send({ from: deployer });

    // Add indentifier to whitelist.
    await identifierWhitelist.methods.addSupportedIdentifier(identifier).send({ from: deployer });
  });
  beforeEach(async function () {
    // Deploy new contracts with clean state and perform setup:
    bondToken = await ERC20.new("BOND", "BOND", 18).send({ from: deployer });
    await bondToken.methods.addMember(TokenRolesEnum.MINTER, deployer).send({ from: deployer });
    await collateralWhitelist.methods.addToWhitelist(bondToken.options.address).send({ from: deployer });
    await store.methods.setFinalFee(bondToken.options.address, { rawValue: finalFee }).send({ from: deployer });

    optimisticDistributor = await OptimisticDistributor.new(
      finder.options.address,
      bondToken.options.address,
      timer.options.address,
      maximumFundingPeriod,
      maximumProposerBond
    ).send({ from: deployer });

    // Merkle Distributor was deployed through Optimistic Distributor constructor.
    const merkleDistributorAddress = await optimisticDistributor.methods.merkleDistributor().call();
    merkleDistributor = getContract("MerkleDistributor").at(merkleDistributorAddress);

    rewardToken = await ERC20.new("REWARD", "REWARD", 18).send({ from: deployer });
    await rewardToken.methods.addMember(TokenRolesEnum.MINTER, deployer).send({ from: deployer });
    await mintAndApprove(rewardToken, sponsor, optimisticDistributor.options.address, rewardAmount, deployer);

    // Get current time and set default earliestProposalTimestamp.
    const currentTime = parseInt(await timer.methods.getCurrentTime().call());
    earliestProposalTimestamp = currentTime + fundingPeriod;

    // Populate reward parameters that will be used in multiple tests.
    defaultRewardParameters = [
      rewardAmount,
      earliestProposalTimestamp,
      bondAmount,
      proposalLiveness,
      identifier,
      rewardToken.options.address,
      customAncillaryData,
    ];
  });
  it("Constructor parameters validation", async function () {
    // Unapproved token.
    assert(
      await didContractRevertWith(
        OptimisticDistributor.new(
          finder.options.address,
          (await ERC20.new("BOND", "BOND", 18).send({ from: deployer })).options.address,
          timer.options.address,
          maximumFundingPeriod,
          maximumProposerBond
        ).send({ from: deployer }),
        "Bond token not supported"
      )
    );
  });
  it("Initial paremeters set", async function () {
    // Deploy new OptimisticDistributor contract to isolate from other tests.
    const testOptimisticDistributor = await OptimisticDistributor.new(
      finder.options.address,
      bondToken.options.address,
      timer.options.address,
      maximumFundingPeriod,
      maximumProposerBond
    ).send({ from: deployer });

    // Verify all parameters have been set correctly.
    assert.equal(await testOptimisticDistributor.methods.finder().call(), finder.options.address);
    assert.equal(await testOptimisticDistributor.methods.bondToken().call(), bondToken.options.address);
    assert.equal(await testOptimisticDistributor.methods.maximumFundingPeriod().call(), maximumFundingPeriod);
    assert.equal(await testOptimisticDistributor.methods.maximumProposerBond().call(), maximumProposerBond);
    assert.equal(await testOptimisticDistributor.methods.optimisticOracle().call(), optimisticOracle.options.address);
    assert.equal(
      await testOptimisticDistributor.methods.ancillaryBytesLimit().call(),
      await optimisticOracle.methods.ancillaryBytesLimit().call()
    );

    // Verify the linked Merkle Distributor contract is owned by Optimistic Distributor.
    const merkleDistributorAddress = await testOptimisticDistributor.methods.merkleDistributor().call();
    const testMerkleDistributor = getContract("MerkleDistributor").at(merkleDistributorAddress);
    assert.equal(await testMerkleDistributor.methods.owner().call(), testOptimisticDistributor.options.address);
  });
  it("UMA ecosystem parameters updated", async function () {
    // Deploy new UMA contracts with updated final fee.
    const newStore = await Store.new(zeroRawValue, zeroRawValue, timer.options.address).send({ from: deployer });
    const newFinalFee = toWei("200");
    await newStore.methods.setFinalFee(bondToken.options.address, { rawValue: newFinalFee }).send({ from: deployer });
    const newOptimisticOracle = await OptimisticOracleV2.new(7200, finder.options.address, timer.options.address).send({
      from: deployer,
    });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Store), newStore.options.address)
      .send({ from: deployer });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.OptimisticOracleV2), newOptimisticOracle.options.address)
      .send({ from: deployer });

    // Check that OptimisticDistributor can fetch new parameters.
    await optimisticDistributor.methods.syncUmaEcosystemParams().send({ from: anyAddress });
    assert.equal(await optimisticDistributor.methods.optimisticOracle().call(), newOptimisticOracle.options.address);

    // Revert back Store and OptimisticOracle implementation in Finder for other tests to use.
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Store), store.options.address)
      .send({ from: deployer });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.OptimisticOracleV2), optimisticOracle.options.address)
      .send({ from: deployer });
  });
  it("Creating initial rewards", async function () {
    // Cannot deposit rewards with earliestProposalTimestamp beyond the maximum funding period limit.
    const currentTimestamp = parseInt(await timer.methods.getCurrentTime().call());
    assert(
      await didContractRevertWith(
        optimisticDistributor.methods
          .createReward(
            rewardAmount,
            currentTimestamp + maximumFundingPeriod + 1,
            bondAmount,
            proposalLiveness,
            identifier,
            rewardToken.options.address,
            customAncillaryData
          )
          .send({ from: sponsor }),
        "Too long till proposal opening"
      )
    );

    // Cannot deposit rewards with too high Optimistic Oracle proposer bond.
    assert(
      await didContractRevertWith(
        optimisticDistributor.methods
          .createReward(
            rewardAmount,
            earliestProposalTimestamp,
            toBN(maximumProposerBond).add(toBN("1")).toString(),
            proposalLiveness,
            identifier,
            rewardToken.options.address,
            customAncillaryData
          )
          .send({ from: sponsor }),
        "OO proposer bond too high"
      )
    );

    // Cannot deposit rewards for unregistered price identifier.
    assert(
      await didContractRevertWith(
        optimisticDistributor.methods
          .createReward(
            rewardAmount,
            earliestProposalTimestamp,
            bondAmount,
            proposalLiveness,
            utf8ToHex("UNREGISTERED"),
            rewardToken.options.address,
            customAncillaryData
          )
          .send({ from: sponsor }),
        "Identifier not registered"
      )
    );

    // Get max length from contract for testing ancillary data size limits.
    const maxLength = parseInt(await optimisticOracle.methods.ancillaryBytesLimit().call());

    // Remove the OO bytes.
    const ooAncillary = await optimisticOracle.methods.stampAncillaryData(customAncillaryData, randomHex(20)).call();
    const remainingLength = maxLength - (ooAncillary.length - customAncillaryData.length) / 2; // Divide by 2 to get bytes.

    // Adding 1 byte to ancillary data should push it just over the limit (less ANCILLARY_BYTES_RESERVE of 512).
    assert(
      await didContractRevertWith(
        optimisticDistributor.methods
          .createReward(
            rewardAmount,
            earliestProposalTimestamp,
            bondAmount,
            proposalLiveness,
            identifier,
            rewardToken.options.address,
            randomHex(remainingLength - ancillaryBytesReserve + 1)
          )
          .send({ from: sponsor }),
        "Ancillary data too long"
      )
    );

    // Ancillary data exactly at the limit should be accepted.
    await optimisticDistributor.methods
      .createReward(
        rewardAmount,
        earliestProposalTimestamp,
        bondAmount,
        proposalLiveness,
        identifier,
        rewardToken.options.address,
        randomHex(remainingLength - ancillaryBytesReserve)
      )
      .send({ from: sponsor });

    // Fund sponsor for creating new rewards.
    await mintAndApprove(rewardToken, sponsor, optimisticDistributor.options.address, rewardAmount, deployer);

    // optimisticOracleLivenessTime below MINIMUM_LIVENESS should revert.
    assert(
      await didContractRevertWith(
        optimisticDistributor.methods
          .createReward(
            rewardAmount,
            earliestProposalTimestamp,
            bondAmount,
            minimumLiveness - 1,
            identifier,
            rewardToken.options.address,
            customAncillaryData
          )
          .send({ from: sponsor }),
        "OO liveness too small"
      )
    );

    // optimisticOracleLivenessTime exactly at MINIMUM_LIVENESS should be accepted.
    await optimisticDistributor.methods
      .createReward(
        rewardAmount,
        earliestProposalTimestamp,
        bondAmount,
        minimumLiveness,
        identifier,
        rewardToken.options.address,
        customAncillaryData
      )
      .send({ from: sponsor });

    // Fund sponsor for creating new rewards.
    await mintAndApprove(rewardToken, sponsor, optimisticDistributor.options.address, rewardAmount, deployer);

    // optimisticOracleLivenessTime exactly at MAXIMUM_LIVENESS should revert.
    assert(
      await didContractRevertWith(
        optimisticDistributor.methods
          .createReward(
            rewardAmount,
            earliestProposalTimestamp,
            bondAmount,
            maximumLiveness,
            identifier,
            rewardToken.options.address,
            customAncillaryData
          )
          .send({ from: sponsor }),
        "OO liveness too large"
      )
    );

    // optimisticOracleLivenessTime just below MAXIMUM_LIVENESS should be accepted.
    let receipt = await optimisticDistributor.methods
      .createReward(
        rewardAmount,
        earliestProposalTimestamp,
        bondAmount,
        maximumLiveness - 1,
        identifier,
        rewardToken.options.address,
        customAncillaryData
      )
      .send({ from: sponsor });

    // Fund sponsor for creating new rewards.
    await mintAndApprove(rewardToken, sponsor, optimisticDistributor.options.address, rewardAmount, deployer);

    // Fetch balances before creating new reward.
    const sponsorBalanceBefore = toBN(await rewardToken.methods.balanceOf(sponsor).call());
    const contractBalanceBefore = toBN(
      await rewardToken.methods.balanceOf(optimisticDistributor.options.address).call()
    );

    // Calculate expected next rewardIndex from the previous successful createReward transaction.
    const rewardIndex = parseInt(receipt.events.RewardCreated.returnValues.rewardIndex) + 1;

    // Create new reward.
    receipt = await optimisticDistributor.methods.createReward(...defaultRewardParameters).send({ from: sponsor });

    // Fetch balances after creating new reward.
    const sponsorBalanceAfter = toBN(await rewardToken.methods.balanceOf(sponsor).call());
    const contractBalanceAfter = toBN(
      await rewardToken.methods.balanceOf(optimisticDistributor.options.address).call()
    );

    // Check for correct change in balances.
    assert.equal(sponsorBalanceBefore.sub(sponsorBalanceAfter).toString(), rewardAmount);
    assert.equal(contractBalanceAfter.sub(contractBalanceBefore).toString(), rewardAmount);

    // Check that created rewards are emitted.
    await assertEventEmitted(
      receipt,
      optimisticDistributor,
      "RewardCreated",
      (event) =>
        event.sponsor === sponsor &&
        event.rewardToken === rewardToken.options.address &&
        event.rewardIndex === rewardIndex.toString() &&
        event.maximumRewardAmount === rewardAmount &&
        event.earliestProposalTimestamp === earliestProposalTimestamp.toString() &&
        event.optimisticOracleProposerBond === bondAmount &&
        event.optimisticOracleLivenessTime === proposalLiveness.toString() &&
        hexToUtf8(event.priceIdentifier) === hexToUtf8(identifier) &&
        event.customAncillaryData === customAncillaryData
    );

    // Compare stored rewards with expected results.
    const storedRewards = await optimisticDistributor.methods.rewards(rewardIndex).call();
    assert.isFalse(storedRewards.distributionExecuted);
    assert.equal(storedRewards.sponsor, sponsor);
    assert.equal(storedRewards.rewardToken, rewardToken.options.address);
    assert.equal(storedRewards.maximumRewardAmount, rewardAmount);
    assert.equal(storedRewards.earliestProposalTimestamp, earliestProposalTimestamp);
    assert.equal(storedRewards.optimisticOracleProposerBond, bondAmount);
    assert.equal(storedRewards.optimisticOracleLivenessTime, proposalLiveness);
    assert.equal(storedRewards.previousProposalTimestamp, "0");
    assert.equal(hexToUtf8(storedRewards.priceIdentifier), hexToUtf8(identifier));
    assert.equal(storedRewards.customAncillaryData, customAncillaryData);
  });
  it("Increasing rewards", async function () {
    // As no rewards have been posted increaseReward should revert.
    const rewardIndex = 0;
    assert(
      await didContractRevertWith(
        optimisticDistributor.methods.increaseReward(rewardIndex, rewardAmount).send({ from: sponsor }),
        "Invalid rewardIndex"
      )
    );

    // Create initial rewards, rewardIndex will be 0.
    await optimisticDistributor.methods.createReward(...defaultRewardParameters).send({ from: sponsor });

    // Fund another wallet and post additional rewards.
    await mintAndApprove(rewardToken, anyAddress, optimisticDistributor.options.address, rewardAmount, deployer);
    await optimisticDistributor.methods.increaseReward(rewardIndex, rewardAmount).send({ from: anyAddress });

    // Fund original sponsor for additional rewards.
    await mintAndApprove(rewardToken, sponsor, optimisticDistributor.options.address, rewardAmount, deployer);

    // Fetch balances before additional funding.
    const sponsorBalanceBefore = toBN(await rewardToken.methods.balanceOf(sponsor).call());
    const contractBalanceBefore = toBN(
      await rewardToken.methods.balanceOf(optimisticDistributor.options.address).call()
    );
    const contractRewardBefore = toBN(
      (await optimisticDistributor.methods.rewards(rewardIndex).call()).maximumRewardAmount
    );

    // Increase rewards funding.
    const receipt = await optimisticDistributor.methods
      .increaseReward(rewardIndex, rewardAmount)
      .send({ from: sponsor });

    // Check that increased rewards are emitted.
    await assertEventEmitted(
      receipt,
      optimisticDistributor,
      "RewardIncreased",
      (event) =>
        event.rewardIndex === rewardIndex.toString() &&
        event.newMaximumRewardAmount === contractRewardBefore.add(toBN(rewardAmount)).toString()
    );

    // Fetch balances after additional funding.
    const sponsorBalanceAfter = toBN(await rewardToken.methods.balanceOf(sponsor).call());
    const contractBalanceAfter = toBN(
      await rewardToken.methods.balanceOf(optimisticDistributor.options.address).call()
    );
    const contractRewardAfter = toBN(
      (await optimisticDistributor.methods.rewards(rewardIndex).call()).maximumRewardAmount
    );

    // Check for correct change in balances.
    assert.equal(sponsorBalanceBefore.sub(sponsorBalanceAfter).toString(), rewardAmount);
    assert.equal(contractBalanceAfter.sub(contractBalanceBefore).toString(), rewardAmount);
    assert.equal(contractRewardAfter.sub(contractRewardBefore).toString(), rewardAmount);

    // Advancing time by fundingPeriod should reach exactly earliestProposalTimestamp as it was calculated
    // by adding fundingPeriod to current time when initial rewards were created.
    await advanceTime(fundingPeriod);

    // It should not be possible to post additional rewards after fundingPeriod.
    assert(
      await didContractRevertWith(
        optimisticDistributor.methods.increaseReward(rewardIndex, rewardAmount).send({ from: sponsor }),
        "Funding period ended"
      )
    );
  });
  it("Submitting proposal", async function () {
    // Fund proposer wallet.
    const totalBond = toBN(bondAmount).add(toBN(finalFee)).toString();
    await mintAndApprove(bondToken, proposer, optimisticDistributor.options.address, totalBond, deployer);

    // Fetch bond token balances before proposal.
    const proposerBalanceBefore = toBN(await bondToken.methods.balanceOf(proposer).call());
    const contractBalanceBefore = toBN(await bondToken.methods.balanceOf(optimisticDistributor.options.address).call());
    const oracleBalanceBefore = toBN(await bondToken.methods.balanceOf(optimisticOracle.options.address).call());

    const merkleRoot = randomHex(32);

    // Proposing on non existing reward (rewardIndex = 0) should revert.
    assert(
      await didContractRevertWith(
        optimisticDistributor.methods.proposeDistribution(0, merkleRoot, ipfsHash).send({ from: proposer }),
        "Invalid rewardIndex"
      )
    );

    // Expected rewardIndex = 0.
    await optimisticDistributor.methods.createReward(...defaultRewardParameters).send({ from: sponsor });
    const rewardIndex = 0;

    // Proposing before earliestProposalTimestamp should revert.
    assert(
      await didContractRevertWith(
        optimisticDistributor.methods.proposeDistribution(rewardIndex, merkleRoot, ipfsHash).send({ from: proposer }),
        "Cannot propose in funding period"
      )
    );

    // Advancing time by fundingPeriod should reach exactly earliestProposalTimestamp as it was calculated
    // by adding fundingPeriod to current time when initial rewards were created.
    await advanceTime(fundingPeriod);

    // Distribution proposal should bow be accepted.
    const receipt = await optimisticDistributor.methods
      .proposeDistribution(rewardIndex, merkleRoot, ipfsHash)
      .send({ from: proposer });

    // Ancillary data in OptimisticOracle should have rewardIndex appended.
    const ancillaryData = utf8ToHex(hexToUtf8(customAncillaryData) + ",rewardIndex:" + rewardIndex);

    // Generate expected proposalId.
    const proposalTimestamp = parseInt(await timer.methods.getCurrentTime().call());
    const proposalId = generateProposalId(identifier, proposalTimestamp, ancillaryData);

    // Check all fields emitted by OptimisticDistributor in ProposalCreated event.
    await assertEventEmitted(
      receipt,
      optimisticDistributor,
      "ProposalCreated",
      (event) =>
        event.sponsor === sponsor &&
        event.rewardToken === rewardToken.options.address &&
        event.proposalTimestamp === proposalTimestamp.toString() &&
        event.maximumRewardAmount === rewardAmount &&
        event.proposalId === proposalId &&
        event.merkleRoot === merkleRoot &&
        hexToUtf8(event.ipfsHash) === hexToUtf8(ipfsHash)
    );

    // Check all fields emitted by OptimisticOracle in RequestPrice event.
    await assertEventEmitted(
      receipt,
      optimisticOracle,
      "RequestPrice",
      (event) =>
        event.requester === optimisticDistributor.options.address &&
        hexToUtf8(event.identifier) === hexToUtf8(identifier) &&
        event.timestamp === proposalTimestamp.toString() &&
        event.ancillaryData === ancillaryData &&
        event.currency === bondToken.options.address &&
        event.reward === "0" &&
        event.finalFee === finalFee.toString()
    );

    // Check all fields emitted by OptimisticOracle in ProposePrice event.
    await assertEventEmitted(
      receipt,
      optimisticOracle,
      "ProposePrice",
      (event) =>
        event.requester === optimisticDistributor.options.address &&
        event.proposer === proposer &&
        hexToUtf8(event.identifier) === hexToUtf8(identifier) &&
        event.timestamp === proposalTimestamp.toString() &&
        event.ancillaryData === ancillaryData &&
        event.proposedPrice === toWei("1") &&
        event.expirationTimestamp === (proposalTimestamp + proposalLiveness).toString() &&
        event.currency === bondToken.options.address
    );

    // OptimisticOracle does not emit event on setBond, thus need to fetch it from stored request.
    const request = await optimisticOracle.methods
      .getRequest(optimisticDistributor.options.address, identifier, proposalTimestamp, ancillaryData)
      .call();
    assert.equal(request.requestSettings.bond, bondAmount);

    // Fetch bond token balances after proposal.
    const proposerBalanceAfter = toBN(await bondToken.methods.balanceOf(proposer).call());
    const contractBalanceAfter = toBN(await bondToken.methods.balanceOf(optimisticDistributor.options.address).call());
    const oracleBalanceAfter = toBN(await bondToken.methods.balanceOf(optimisticOracle.options.address).call());

    // Check for correct change in balances.
    assert.equal(proposerBalanceBefore.sub(proposerBalanceAfter).toString(), totalBond);
    assert.equal(contractBalanceAfter.toString(), contractBalanceBefore.toString());
    assert.equal(oracleBalanceAfter.sub(oracleBalanceBefore).toString(), totalBond);

    // Check stored proposal.
    const storedProposal = await optimisticDistributor.methods.proposals(proposalId).call();
    assert.equal(storedProposal.rewardIndex, rewardIndex);
    assert.equal(storedProposal.timestamp, proposalTimestamp);
    assert.equal(storedProposal.merkleRoot, merkleRoot);
    assert.equal(hexToUtf8(storedProposal.ipfsHash), hexToUtf8(ipfsHash));

    // Any further proposals should now be blocked till disputed.
    await advanceTime(100);
    await mintAndApprove(bondToken, proposer, optimisticDistributor.options.address, totalBond, deployer);
    assert(
      await didContractRevertWith(
        optimisticDistributor.methods.proposeDistribution(rewardIndex, merkleRoot, ipfsHash).send({ from: proposer }),
        "New proposals blocked"
      )
    );

    // Dispute the proposal at the OptimisticOracle.
    await advanceTime(100);
    await mintAndApprove(bondToken, disputer, optimisticOracle.options.address, totalBond, deployer);
    await optimisticOracle.methods
      .disputePrice(optimisticDistributor.options.address, identifier, proposalTimestamp, ancillaryData)
      .send({ from: disputer });

    // New proposals should now be unblocked as a result of disputing previous proposal.
    await optimisticDistributor.methods.proposeDistribution(rewardIndex, merkleRoot, ipfsHash).send({ from: proposer });
  });
  it("Executing distribution, undisputed", async function () {
    // Executing distribution for non-exisiting proposal should revert.
    let proposalId = padRight("0x00", 64);
    assert(
      await didContractRevertWith(
        optimisticDistributor.methods.executeDistribution(proposalId).send({ from: anyAddress }),
        "Invalid proposalId"
      )
    );

    // Perform create-propose rewards cycle.
    const rewardIndex = 0;
    const [totalBond, ancillaryData, proposalTimestamp, merkleRoot] = await createProposeRewards(rewardIndex);
    proposalId = generateProposalId(identifier, proposalTimestamp, ancillaryData);

    // Execute distribution 1 second before OO liveness ends should revert.
    await advanceTime(proposalLiveness - 1);
    assert(
      await didContractRevertWith(
        optimisticDistributor.methods.executeDistribution(proposalId).send({ from: anyAddress }),
        "_settle: not settleable"
      )
    );

    // Fetch token balances before executing proposal.
    const proposerBondBalanceBefore = toBN(await bondToken.methods.balanceOf(proposer).call());
    const contractRewardBalanceBefore = toBN(
      await rewardToken.methods.balanceOf(optimisticDistributor.options.address).call()
    );
    const merkleRewardBalancesBefore = toBN(
      await rewardToken.methods.balanceOf(merkleDistributor.options.address).call()
    );

    // Execute undisputed distribution after OO liveness should succeed.
    await advanceTime(1);
    const receipt = await optimisticDistributor.methods.executeDistribution(proposalId).send({ from: anyAddress });

    // Fetch token balances after executing proposal.
    const proposerBondBalanceAfter = toBN(await bondToken.methods.balanceOf(proposer).call());
    const contractRewardBalanceAfter = toBN(
      await rewardToken.methods.balanceOf(optimisticDistributor.options.address).call()
    );
    const merkleRewardBalancesAfter = toBN(
      await rewardToken.methods.balanceOf(merkleDistributor.options.address).call()
    );

    // Check for correct change in balances (bond returned to proposer and rewards transfered from
    // optimisticDistributor to merkleDistributor contract).
    assert.equal(proposerBondBalanceAfter.sub(proposerBondBalanceBefore).toString(), totalBond);
    assert.equal(contractRewardBalanceBefore.sub(contractRewardBalanceAfter).toString(), rewardAmount);
    assert.equal(merkleRewardBalancesAfter.sub(merkleRewardBalancesBefore).toString(), rewardAmount);

    // Check all fields emitted by optimisticDistributor in RewardDistributed event.
    await assertEventEmitted(
      receipt,
      optimisticDistributor,
      "RewardDistributed",
      (event) =>
        event.sponsor === sponsor &&
        event.rewardToken === rewardToken.options.address &&
        event.rewardIndex === rewardIndex.toString() &&
        event.maximumRewardAmount === rewardAmount &&
        event.proposalId === proposalId &&
        event.merkleRoot === merkleRoot &&
        hexToUtf8(event.ipfsHash) === hexToUtf8(ipfsHash)
    );

    // Check fields emitted by merkleDistributor in CreatedWindow event.
    await assertEventEmitted(
      receipt,
      merkleDistributor,
      "CreatedWindow",
      (event) =>
        event.rewardsDeposited === rewardAmount &&
        event.rewardToken === rewardToken.options.address &&
        event.owner === optimisticDistributor.options.address
    );

    // Repeated execution should revert.
    assert(
      await didContractRevertWith(
        optimisticDistributor.methods.executeDistribution(proposalId).send({ from: anyAddress }),
        "Reward already distributed"
      )
    );

    // Any further proposals should now be blocked.
    await advanceTime(100);
    await mintAndApprove(bondToken, proposer, optimisticDistributor.options.address, totalBond, deployer);
    assert(
      await didContractRevertWith(
        optimisticDistributor.methods.proposeDistribution(rewardIndex, merkleRoot, ipfsHash).send({ from: proposer }),
        "Reward already distributed"
      )
    );
  });
  it("Executing distribution, rejected by DVM", async function () {
    // Perform create-propose rewards cycle.
    const rewardIndex = 0;
    const [totalBond, ancillaryData, proposalTimestamp] = await createProposeRewards(rewardIndex);
    const proposalId = generateProposalId(identifier, proposalTimestamp, ancillaryData);

    // Dispute the proposal at the OptimisticOracle.
    await mintAndApprove(bondToken, disputer, optimisticOracle.options.address, totalBond, deployer);
    await optimisticOracle.methods
      .disputePrice(optimisticDistributor.options.address, identifier, proposalTimestamp, ancillaryData)
      .send({ from: disputer });

    // Execute distribution should revert as proposal was disputed and has not been resolved by DVM.
    assert(
      await didContractRevertWith(
        optimisticDistributor.methods.executeDistribution(proposalId).send({ from: anyAddress }),
        "_settle: not settleable"
      )
    );

    // Resolve price request invalid at DVM.
    const dvmAncillaryData = await optimisticOracle.methods
      .stampAncillaryData(ancillaryData, optimisticDistributor.options.address)
      .call();
    await mockOracle.methods
      .pushPrice(identifier, proposalTimestamp, dvmAncillaryData, toWei("0"))
      .send({ from: deployer });

    // Fetch token balances before executing proposal.
    const proposerBondBalanceBefore = toBN(await bondToken.methods.balanceOf(proposer).call());
    const disputerBondBalanceBefore = toBN(await bondToken.methods.balanceOf(disputer).call());
    const contractRewardBalanceBefore = toBN(
      await rewardToken.methods.balanceOf(optimisticDistributor.options.address).call()
    );
    const merkleRewardBalancesBefore = toBN(
      await rewardToken.methods.balanceOf(merkleDistributor.options.address).call()
    );

    // Executing rejected distribution does not revert, but we check events and balances below.
    const receipt = await optimisticDistributor.methods.executeDistribution(proposalId).send({ from: anyAddress });

    // Fetch token balances after executing proposal.
    const proposerBondBalanceAfter = toBN(await bondToken.methods.balanceOf(proposer).call());
    const disputerBondBalanceAfter = toBN(await bondToken.methods.balanceOf(disputer).call());
    const contractRewardBalanceAfter = toBN(
      await rewardToken.methods.balanceOf(optimisticDistributor.options.address).call()
    );
    const merkleRewardBalancesAfter = toBN(
      await rewardToken.methods.balanceOf(merkleDistributor.options.address).call()
    );

    // Check for correct change in balances (disputer should receive back its posted final fee (100) + bond (500)
    // + half of proposers bond (250) = 850, rewards not moved out of optimisticDistributor).
    assert.equal(proposerBondBalanceAfter.toString(), proposerBondBalanceBefore.toString());
    assert.equal(
      disputerBondBalanceAfter.sub(disputerBondBalanceBefore).toString(),
      toBN(totalBond)
        .add(toBN(bondAmount).div(toBN("2")))
        .toString()
    );
    assert.equal(contractRewardBalanceAfter.toString(), contractRewardBalanceBefore.toString());
    assert.equal(merkleRewardBalancesAfter.toString(), merkleRewardBalancesBefore.toString());

    // Check all fields emitted by optimisticDistributor in ProposalRejected event.
    await assertEventEmitted(
      receipt,
      optimisticDistributor,
      "ProposalRejected",
      (event) => event.rewardIndex === rewardIndex.toString() && event.proposalId === proposalId
    );
  });
  it("Executing distribution, confirmed by DVM", async function () {
    // Perform create-propose rewards cycle.
    const rewardIndex = 0;
    const [totalBond, ancillaryData, proposalTimestamp, merkleRoot] = await createProposeRewards(rewardIndex);
    const proposalId = generateProposalId(identifier, proposalTimestamp, ancillaryData);

    // Dispute the proposal at the OptimisticOracle.
    await mintAndApprove(bondToken, disputer, optimisticOracle.options.address, totalBond, deployer);
    await optimisticOracle.methods
      .disputePrice(optimisticDistributor.options.address, identifier, proposalTimestamp, ancillaryData)
      .send({ from: disputer });

    // Resolve price request as valid at DVM.
    const dvmAncillaryData = await optimisticOracle.methods
      .stampAncillaryData(ancillaryData, optimisticDistributor.options.address)
      .call();
    await mockOracle.methods
      .pushPrice(identifier, proposalTimestamp, dvmAncillaryData, toWei("1"))
      .send({ from: deployer });

    // Fetch token balances before executing proposal.
    const proposerBondBalanceBefore = toBN(await bondToken.methods.balanceOf(proposer).call());
    const disputerBondBalanceBefore = toBN(await bondToken.methods.balanceOf(disputer).call());
    const contractRewardBalanceBefore = toBN(
      await rewardToken.methods.balanceOf(optimisticDistributor.options.address).call()
    );
    const merkleRewardBalancesBefore = toBN(
      await rewardToken.methods.balanceOf(merkleDistributor.options.address).call()
    );

    // Executing confirmed distribution should be accepted.
    const receipt = await optimisticDistributor.methods.executeDistribution(proposalId).send({ from: anyAddress });

    // Fetch token balances after executing proposal.
    const proposerBondBalanceAfter = toBN(await bondToken.methods.balanceOf(proposer).call());
    const disputerBondBalanceAfter = toBN(await bondToken.methods.balanceOf(disputer).call());
    const contractRewardBalanceAfter = toBN(
      await rewardToken.methods.balanceOf(optimisticDistributor.options.address).call()
    );
    const merkleRewardBalancesAfter = toBN(
      await rewardToken.methods.balanceOf(merkleDistributor.options.address).call()
    );

    // Check for correct change in balances (proposer should receive back its posted final fee (100) + bond (500)
    // + half of disputers bond (250) = 850, rewards moved out of optimisticDistributor to merkleDistributor).
    assert.equal(
      proposerBondBalanceAfter.sub(proposerBondBalanceBefore).toString(),
      toBN(totalBond)
        .add(toBN(bondAmount).div(toBN("2")))
        .toString()
    );
    assert.equal(disputerBondBalanceAfter.toString(), disputerBondBalanceBefore.toString());
    assert.equal(contractRewardBalanceBefore.sub(contractRewardBalanceAfter).toString(), rewardAmount);
    assert.equal(merkleRewardBalancesAfter.sub(merkleRewardBalancesBefore).toString(), rewardAmount);

    // Check all fields emitted by optimisticDistributor in RewardDistributed event.
    await assertEventEmitted(
      receipt,
      optimisticDistributor,
      "RewardDistributed",
      (event) =>
        event.sponsor === sponsor &&
        event.rewardToken === rewardToken.options.address &&
        event.rewardIndex === rewardIndex.toString() &&
        event.maximumRewardAmount === rewardAmount &&
        event.proposalId === proposalId &&
        event.merkleRoot === merkleRoot &&
        hexToUtf8(event.ipfsHash) === hexToUtf8(ipfsHash)
    );

    // Check fields emitted by merkleDistributor in CreatedWindow event.
    await assertEventEmitted(
      receipt,
      merkleDistributor,
      "CreatedWindow",
      (event) =>
        event.rewardsDeposited === rewardAmount &&
        event.rewardToken === rewardToken.options.address &&
        event.owner === optimisticDistributor.options.address
    );

    // Repeated execution should revert.
    assert(
      await didContractRevertWith(
        optimisticDistributor.methods.executeDistribution(proposalId).send({ from: anyAddress }),
        "Reward already distributed"
      )
    );

    // Any further proposals should now be blocked.
    await advanceTime(100);
    await mintAndApprove(bondToken, proposer, optimisticDistributor.options.address, totalBond, deployer);
    assert(
      await didContractRevertWith(
        optimisticDistributor.methods.proposeDistribution(rewardIndex, merkleRoot, ipfsHash).send({ from: proposer }),
        "Reward already distributed"
      )
    );
  });
  it("Cannot distribute rewards twice", async function () {
    // Perform create-propose rewards cycle.
    let rewardIndex = 0;
    const [totalBond, ancillaryData, firstProposalTimestamp, merkleRoot] = await createProposeRewards(rewardIndex);
    const firstProposalId = generateProposalId(identifier, firstProposalTimestamp, ancillaryData);

    // Dispute the first proposal at the OptimisticOracle.
    await advanceTime(100);
    await mintAndApprove(bondToken, disputer, optimisticOracle.options.address, totalBond, deployer);
    await optimisticOracle.methods
      .disputePrice(optimisticDistributor.options.address, identifier, firstProposalTimestamp, ancillaryData)
      .send({ from: disputer });

    // Post second proposal with same data.
    await advanceTime(100);
    await mintAndApprove(bondToken, proposer, optimisticDistributor.options.address, totalBond, deployer);
    const secondProposalTimestamp = parseInt(await timer.methods.getCurrentTime().call());
    await optimisticDistributor.methods.proposeDistribution(rewardIndex, merkleRoot, ipfsHash).send({ from: proposer });

    // DVM confirms the first disputed proposal as valid.
    const dvmAncillaryData = await optimisticOracle.methods
      .stampAncillaryData(ancillaryData, optimisticDistributor.options.address)
      .call();
    await mockOracle.methods
      .pushPrice(identifier, firstProposalTimestamp, dvmAncillaryData, toWei("1"))
      .send({ from: deployer });

    // Executing the first distribution proposal.
    await optimisticDistributor.methods.executeDistribution(firstProposalId).send({ from: anyAddress });

    // Dispute the second proposal at the OptimisticOracle.
    await advanceTime(100);
    await mintAndApprove(bondToken, disputer, optimisticOracle.options.address, totalBond, deployer);
    await optimisticOracle.methods
      .disputePrice(optimisticDistributor.options.address, identifier, secondProposalTimestamp, ancillaryData)
      .send({ from: disputer });

    // Fund another set of rewards.
    rewardIndex++;
    await mintAndApprove(rewardToken, sponsor, optimisticDistributor.options.address, rewardAmount, deployer);
    await createProposeRewards(rewardIndex);

    // Confirm that repeated distribution is blocked.
    assert(
      await didContractRevertWith(
        optimisticDistributor.methods.executeDistribution(firstProposalId).send({ from: anyAddress }),
        "Reward already distributed"
      )
    );
  });
  it("Optimistic Oracle upgrade unblocks proposal", async function () {
    // Deploy new Optimistic Oracle and update in Finder.
    const newOptimisticOracle = await OptimisticOracleV2.new(7200, finder.options.address, timer.options.address).send({
      from: deployer,
    });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.OptimisticOracleV2), newOptimisticOracle.options.address)
      .send({ from: deployer });

    // Perform create-propose rewards cycle.
    const rewardIndex = 0;
    const [totalBond, ancillaryData, previousProposalTimestamp, merkleRoot] = await createProposeRewards(rewardIndex);
    const previousProposalId = generateProposalId(identifier, previousProposalTimestamp, ancillaryData);

    // New proposal should be blocked before OO upgrade sync.
    assert(
      await didContractRevertWith(
        optimisticDistributor.methods.proposeDistribution(rewardIndex, merkleRoot, ipfsHash).send({ from: proposer }),
        "New proposals blocked"
      )
    );

    // Sync upgraded Optimistic Oracle.
    await optimisticDistributor.methods.syncUmaEcosystemParams().send({ from: anyAddress });

    // Execute distribution once reached OO liveness should revert as original request was in old OO.
    await advanceTime(proposalLiveness);
    assert(
      await didContractRevertWith(
        optimisticDistributor.methods.executeDistribution(previousProposalId).send({ from: anyAddress }),
        "_settle: not settleable"
      )
    );

    // New proposal should now be unblocked as OO has been updated.
    await mintAndApprove(bondToken, proposer, optimisticDistributor.options.address, totalBond, deployer);
    await optimisticDistributor.methods.proposeDistribution(rewardIndex, merkleRoot, ipfsHash).send({ from: proposer });

    // Proposer can recover previous bond by settling on old instance of Optimistic Oracle.
    const balanceBeforeSettle = toBN(await bondToken.methods.balanceOf(proposer).call());
    await optimisticOracle.methods
      .settle(optimisticDistributor.options.address, identifier, previousProposalTimestamp, ancillaryData)
      .send({ from: proposer });
    assert.equal(
      await bondToken.methods.balanceOf(proposer).call(),
      balanceBeforeSettle.add(toBN(totalBond)).toString()
    );
  });
});
