const { assert } = require("chai");
const hre = require("hardhat");
const { web3, getContract /* assertEventEmitted, findEvent */ } = hre;
const {
  didContractThrow,
  interfaceName,
  runDefaultFixture,
  TokenRolesEnum /* ZERO_ADDRESS */,
} = require("@uma/common");
const { utf8ToHex, toWei, toBN /* randomHex, toChecksumAddress */ } = web3.utils;

// Tested contracts
const OptimisticOracleModule = getContract("OptimisticOracleModuleTest");

// Helper contracts
const Finder = getContract("Finder");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const AddressWhitelist = getContract("AddressWhitelist");
// const OptimisticOracle = getContract("SkinnyOptimisticOracle");
const MockOracle = getContract("MockOracleAncillary");
const Timer = getContract("Timer");
const Store = getContract("Store");
const ERC20 = getContract("ExpandedERC20");

const finalFee = toWei("100");
const liveness = 7200;
const bond = toWei("500");
const identifier = utf8ToHex("ZODIAC");
const totalBond = toBN(finalFee).add(toBN(bond)).toString();
const rules = "https://insert.gist.text.url";

describe("OptimisticOracleModule", () => {
  let accounts, owner, proposer, disputer /* , executor*/;

  let timer,
    finder,
    collateralWhitelist,
    store,
    identifierWhitelist,
    bondToken,
    mockOracle,
    // optimisticOracle,
    optimisticOracleModule;

  // const advanceTime = async (timeIncrease) => {
  //   await timer.methods
  //     .setCurrentTime(Number(await timer.methods.getCurrentTime().call()) + timeIncrease)
  //     .send({ from: owner });
  // };

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, proposer, disputer /* , executor*/] = accounts;

    await runDefaultFixture(hre);

    timer = await Timer.deployed();
    finder = await Finder.deployed();
    collateralWhitelist = await AddressWhitelist.deployed();
    store = await Store.deployed();
    identifierWhitelist = await IdentifierWhitelist.deployed();
    // optimisticOracle = await OptimisticOracle.deployed();

    // Deploy new MockOracle so that OptimisticOracle disputes can make price requests to it:
    mockOracle = await MockOracle.new(finder.options.address, timer.options.address).send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.options.address)
      .send({ from: owner });
    await identifierWhitelist.methods.addSupportedIdentifier(identifier).send({ from: owner });
  });

  beforeEach(async function () {
    // Deploy new contracts with clean state and perform setup:
    bondToken = await ERC20.new("BOND", "BOND", 18).send({ from: owner });
    await bondToken.methods.addMember(TokenRolesEnum.MINTER, owner).send({ from: owner });
    await collateralWhitelist.methods.addToWhitelist(bondToken.options.address).send({ from: owner });
    await store.methods.setFinalFee(bondToken.options.address, { rawValue: finalFee }).send({ from: owner });

    optimisticOracleModule = await OptimisticOracleModule.new(
      finder.options.address,
      owner,
      bondToken.options.address,
      bond,
      rules,
      identifier,
      liveness,
      timer.options.address
    ).send({ from: owner });

    await bondToken.methods.mint(proposer, totalBond).send({ from: owner });
    await bondToken.methods.approve(optimisticOracleModule.options.address, totalBond).send({ from: proposer });
    await bondToken.methods.mint(disputer, totalBond).send({ from: owner });
    await bondToken.methods.approve(optimisticOracleModule.options.address, totalBond).send({ from: disputer });
  });

  it("Constructor validation", async function () {
    // 0 liveness.
    assert(
      await didContractThrow(
        OptimisticOracleModule.new(
          finder.options.address,
          owner,
          bondToken.options.address,
          bond,
          rules,
          identifier,
          0,
          timer.options.address
        ).send({ from: owner })
      )
    );

    // Unapproved token.
    assert(
      await didContractThrow(
        OptimisticOracleModule.new(
          finder.options.address,
          owner,
          (await ERC20.new("BOND", "BOND", 18).send({ from: owner })).options.address,
          bond,
          rules,
          identifier,
          liveness,
          timer.options.address
        ).send({ from: owner })
      )
    );

    // Unapproved identifier.
    assert(
      await didContractThrow(
        OptimisticOracleModule.new(
          finder.options.address,
          owner,
          bondToken.options.address,
          bond,
          rules,
          utf8ToHex("Unapproved"),
          liveness,
          timer.options.address
        ).send({ from: owner })
      )
    );
  });

  it("Valid proposals should be hashed and stored", async function () {});

  it("Invalid proposals should revert", async function () {});

  it("Owner can update stored contract parameters", async function () {});

  it("Non-owners can not update stored contract parameters", async function () {});

  it("Proposals can be disputed", async function () {});

  it("Approved proposals can be executed by any address", async function () {});

  it("Rejected proposals can not be executed", async function () {});

  it("Rejected proposals can be deleted by any address", async function () {});
});
