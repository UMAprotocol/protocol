const { assert } = require("chai");
const hre = require("hardhat");
const { web3, getContract } = hre;
const { didContractThrow, interfaceName, runDefaultFixture, TokenRolesEnum } = require("@uma/common");
const { utf8ToHex, hexToUtf8, toWei, randomHex } = web3.utils;

// Tested contracts
const OptimisticDistributor = getContract("OptimisticDistributorTest");

// Helper contracts
const Finder = getContract("Finder");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const AddressWhitelist = getContract("AddressWhitelist");
const OptimisticOracle = getContract("OptimisticOracle");
const MockOracle = getContract("MockOracleAncillary");
const Timer = getContract("Timer");
const Store = getContract("Store");
const ERC20 = getContract("ExpandedERC20");
const MerkleDistributor = getContract("MerkleDistributor");

const finalFee = toWei("100");
const identifier = utf8ToHex("TESTID");
const customAncillaryData = utf8ToHex("ABC123");
const zeroRawValue = { rawValue: "0" };
const rewardAmount = toWei("10000");
const bondAmount = toWei("500");
const liveness = 7200;
const ancillaryBytesReserve = 512;
const minimumLiveness = 10 * 60; // 10 minutes
const maximumLiveness = 5200 * 7 * 24 * 60 * 60; // 5200 weeks

let accounts, deployer, maintainer, sponsor;

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
  defaultRewardParameters;

async function mintAndApprove(token, owner, spender, amount, minter) {
  await token.methods.mint(owner, amount).send({ from: minter });
  await token.methods.approve(spender, amount).send({ from: owner });
}

async function setupMerkleDistributor() {
  merkleDistributor = await MerkleDistributor.new().send({ from: deployer });
  await merkleDistributor.methods.transferOwnership(optimisticDistributor.options.address).send({ from: deployer });
  await optimisticDistributor.methods.setMerkleDistributor(merkleDistributor.options.address).send({ from: deployer });
}

describe("OptimisticDistributor", async function () {
  before(async function () {
    accounts = await web3.eth.getAccounts();
    [deployer, maintainer, sponsor] = accounts;

    await runDefaultFixture(hre);

    timer = await Timer.deployed();
    finder = await Finder.deployed();
    collateralWhitelist = await AddressWhitelist.deployed();
    store = await Store.deployed();
    identifierWhitelist = await IdentifierWhitelist.deployed();
    optimisticOracle = await OptimisticOracle.deployed();

    // Deploy new MockOracle so that OptimisticOracle disputes can make price requests to it:
    mockOracle = await MockOracle.new(finder.options.address, timer.options.address).send({ from: deployer });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.options.address)
      .send({ from: deployer });
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
      timer.options.address
    ).send({ from: deployer });

    rewardToken = await ERC20.new("REWARD", "REWARD", 18).send({ from: deployer });
    await rewardToken.methods.addMember(TokenRolesEnum.MINTER, deployer).send({ from: deployer });
    await mintAndApprove(rewardToken, sponsor, optimisticDistributor.options.address, rewardAmount, deployer);

    // Populate reward parameters that will be used in multiple tests.
    defaultRewardParameters = [
      rewardToken.options.address,
      rewardAmount,
      0, // earliestProposalTimestamp
      identifier,
      customAncillaryData,
      bondAmount,
      liveness,
    ];
  });
  it("Constructor parameters validation", async function () {
    // Unapproved token.
    assert(
      await didContractThrow(
        OptimisticDistributor.new(
          finder.options.address,
          (await ERC20.new("BOND", "BOND", 18).send({ from: deployer })).options.address,
          timer.options.address
        ).send({ from: deployer })
      )
    );
  });
  it("Initial paremeters set", async function () {
    // Finder address.
    assert.equal(await optimisticDistributor.methods.finder().call(), finder.options.address);
    // Bond token address.
    assert.equal(await optimisticDistributor.methods.bondToken().call(), bondToken.options.address);
    // Store address.
    assert.equal(await optimisticDistributor.methods.store().call(), store.options.address);
    // Final fee.
    assert.equal(await optimisticDistributor.methods.finalFee().call(), finalFee);
    // Optimistic Oracle address.
    assert.equal(await optimisticDistributor.methods.optimisticOracle().call(), optimisticOracle.options.address);
  });
  it("UMA ecosystem parameters updated", async function () {
    // Deploy new UMA contracts with updated final fee.
    const newStore = await Store.new(zeroRawValue, zeroRawValue, timer.options.address).send({ from: deployer });
    const newFinalFee = toWei("200");
    await newStore.methods.setFinalFee(bondToken.options.address, { rawValue: newFinalFee }).send({ from: deployer });
    const newOptimisticOracle = await OptimisticOracle.new(7200, finder.options.address, timer.options.address).send({
      from: deployer,
    });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Store), newStore.options.address)
      .send({ from: deployer });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.OptimisticOracle), newOptimisticOracle.options.address)
      .send({ from: deployer });

    // Check that OptimisticDistributor can fetch new parameters.
    await optimisticDistributor.methods.syncUmaEcosystemParams().send({ from: maintainer });
    assert.equal(await optimisticDistributor.methods.store().call(), newStore.options.address);
    assert.equal(await optimisticDistributor.methods.finalFee().call(), newFinalFee);
    assert.equal(await optimisticDistributor.methods.optimisticOracle().call(), newOptimisticOracle.options.address);
  });
  it("MerkleDistributor can be set only once", async function () {
    await setupMerkleDistributor();

    // Deploy new MerkleDistributor and try to link it to existing optimisticDistributor.
    const newMerkleDistributor = await MerkleDistributor.new().send({ from: deployer });
    await newMerkleDistributor.methods
      .transferOwnership(optimisticDistributor.options.address)
      .send({ from: deployer });
    assert(
      await didContractThrow(
        optimisticDistributor.methods
          .setMerkleDistributor(newMerkleDistributor.options.address)
          .send({ from: deployer })
      )
    );
  });
  it("MerkleDistributor should be owned by OptimisticDistributor", async function () {
    // Deploy MerkleDistributor and try to link it without transferring ownership first.
    merkleDistributor = await MerkleDistributor.new().send({ from: deployer });
    assert(
      await didContractThrow(
        optimisticDistributor.methods.setMerkleDistributor(merkleDistributor.options.address).send({ from: deployer })
      )
    );
  });
  it("Cannot deposit rewards without MerkleDistributor", async function () {
    // await setupMerkleDistributor() skipped here.

    assert(
      await didContractThrow(
        optimisticDistributor.methods.createReward(...defaultRewardParameters).send({ from: sponsor })
      )
    );
  });
  it("Cannot deposit rewards for unregistered price identifier", async function () {
    await setupMerkleDistributor();

    assert(
      await didContractThrow(
        optimisticDistributor.methods
          .createReward(
            rewardToken.options.address,
            rewardAmount,
            0,
            utf8ToHex("UNREGISTERED"),
            customAncillaryData,
            bondAmount,
            liveness
          )
          .send({ from: sponsor })
      )
    );
  });
  it("Test ancillary data size limits", async function () {
    await setupMerkleDistributor();

    // Get max length from contract.
    const maxLength = parseInt(await optimisticOracle.methods.ancillaryBytesLimit().call());

    // Remove the OO bytes.
    const ooAncillary = await optimisticOracle.methods.stampAncillaryData(customAncillaryData, randomHex(20)).call();
    const remainingLength = maxLength - (ooAncillary.length - customAncillaryData.length) / 2; // Divide by 2 to get bytes.

    // Adding 1 byte to ancillary data should push it just over the limit (less ANCILLARY_BYTES_RESERVE of 512).
    assert(
      await didContractThrow(
        optimisticDistributor.methods
          .createReward(
            rewardToken.options.address,
            rewardAmount,
            0,
            identifier,
            randomHex(remainingLength - ancillaryBytesReserve + 1),
            bondAmount,
            liveness
          )
          .send({ from: sponsor })
      )
    );

    // Ancillary data exactly at the limit should be accepted.
    await optimisticDistributor.methods
      .createReward(
        rewardToken.options.address,
        rewardAmount,
        0,
        identifier,
        randomHex(remainingLength - ancillaryBytesReserve),
        bondAmount,
        liveness
      )
      .send({ from: sponsor });
  });
  it("Test minimum liveness", async function () {
    await setupMerkleDistributor();

    // Below MINIMUM_LIVENESS should revert.
    assert(
      await didContractThrow(
        optimisticDistributor.methods
          .createReward(
            rewardToken.options.address,
            rewardAmount,
            0,
            identifier,
            customAncillaryData,
            bondAmount,
            minimumLiveness - 1
          )
          .send({ from: sponsor })
      )
    );

    // Exactly at MINIMUM_LIVENESS should be accepted.
    await optimisticDistributor.methods
      .createReward(
        rewardToken.options.address,
        rewardAmount,
        0,
        identifier,
        customAncillaryData,
        bondAmount,
        minimumLiveness
      )
      .send({ from: sponsor });
  });
  it("Test maximum liveness", async function () {
    await setupMerkleDistributor();

    // Exactly at MAXIMUM_LIVENESS should revert.
    assert(
      await didContractThrow(
        optimisticDistributor.methods
          .createReward(
            rewardToken.options.address,
            rewardAmount,
            0,
            identifier,
            customAncillaryData,
            bondAmount,
            maximumLiveness
          )
          .send({ from: sponsor })
      )
    );

    // Just below MAXIMUM_LIVENESS should be accepted.
    await optimisticDistributor.methods
      .createReward(
        rewardToken.options.address,
        rewardAmount,
        0,
        identifier,
        customAncillaryData,
        bondAmount,
        maximumLiveness - 1
      )
      .send({ from: sponsor });
  });
  it("Initial rewards are transfered to OptimisticDistributor", async function () {
    await setupMerkleDistributor();

    await optimisticDistributor.methods.createReward(...defaultRewardParameters).send({ from: sponsor });

    // Sponsor should have 0 remaining balance.
    assert.equal(await rewardToken.methods.balanceOf(sponsor).call(), toWei("0"));

    // OptimisticDistributor should have reward balance.
    assert.equal(await rewardToken.methods.balanceOf(optimisticDistributor.options.address).call(), rewardAmount);
  });
  it("Rewards are stored on chain", async function () {
    await setupMerkleDistributor();

    const rewardIndex = parseInt(await optimisticDistributor.methods.nextCreatedReward().call());
    await optimisticDistributor.methods.createReward(...defaultRewardParameters).send({ from: sponsor });

    // Compare stored rewards with provided inputs.
    const storedRewards = await optimisticDistributor.methods.rewards(rewardIndex).call();
    assert.equal(storedRewards.sponsor, sponsor);
    assert.equal(storedRewards.rewardToken, rewardToken.options.address);
    assert.equal(storedRewards.maximumRewardAmount, rewardAmount);
    assert.equal(storedRewards.earliestProposalTimestamp, 0);
    assert.equal(hexToUtf8(storedRewards.priceIdentifier), hexToUtf8(identifier));
    assert.equal(storedRewards.customAncillaryData, customAncillaryData);
    assert.equal(storedRewards.optimisticOracleProposerBond, bondAmount);
    assert.equal(storedRewards.optimisticOracleLivenessTime, liveness);

    // Check that nextCreatedReward index got bumped.
    assert.equal(parseInt(await optimisticDistributor.methods.nextCreatedReward().call()), rewardIndex + 1);
  });
  it("increaseReward should revert if initial rewards have not been posted", async function () {
    await setupMerkleDistributor();

    // As no rewards have been posted zero index rewards struct will point to zero address.
    assert(
      await didContractThrow(optimisticDistributor.methods.increaseReward(0, rewardAmount).send({ from: sponsor }))
    );
  });
});
