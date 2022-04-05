const { assert } = require("chai");
const hre = require("hardhat");
const { web3, getContract } = hre;
const { didContractThrow, interfaceName, runDefaultFixture, TokenRolesEnum } = require("@uma/common");
const { utf8ToHex, toWei } = web3.utils;

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

const finalFee = toWei("100");
const identifier = utf8ToHex("TESTID");
const zeroRawValue = { rawValue: "0" };

describe("OptimisticDistributor", async function () {
  let accounts, deployer, maintainer;

  let timer,
    finder,
    collateralWhitelist,
    store,
    identifierWhitelist,
    bondToken,
    mockOracle,
    optimisticDistributor,
    optimisticOracle;

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [deployer, maintainer] = accounts;

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
});
