const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract } = hre;
const { assert } = require("chai");
const { didContractThrow, interfaceName, RegistryRolesEnum } = require("@uma/common");
const SinkGovernor = getContract("SinkGovernor");
const Finder = getContract("Finder");
const Registry = getContract("Registry");
const Bridge = getContract("Bridge");
const GenericHandler = getContract("GenericHandler");
const ERC20 = getContract("ExpandedERC20");

const { utf8ToHex } = web3.utils;

const { blankFunctionSig, createGenericDepositData, getFunctionSignature } = require("./helpers");

describe("SinkGovernor", async () => {
  let accounts;
  let owner;
  let rando;

  let sinkGovernor;
  let erc20;
  let registry;
  let finder;
  let bridge;
  let handler;

  const chainID = 1;
  const expectedDepositNonce = 1;

  let sinkGovernorResourceId;

  const getResourceId = (chainId) => {
    const encodedParams = web3.eth.abi.encodeParameters(
      ["bytes32", "uint8"],
      [web3.utils.utf8ToHex("Governor"), chainId]
    );
    return web3.utils.soliditySha3(encodedParams);
  };

  before(async () => {
    accounts = await web3.eth.getAccounts();
    [owner, rando] = accounts;
    await runDefaultFixture(hre);
    registry = await Registry.deployed();
    await registry.methods.addMember(RegistryRolesEnum.CONTRACT_CREATOR, owner).send({ from: accounts[0] });
    await registry.methods.registerContract([], owner).send({ from: owner });
    finder = await Finder.deployed();
    await finder.methods.changeImplementationAddress(utf8ToHex(interfaceName.Registry), registry.options.address);
  });

  beforeEach(async function () {
    bridge = await Bridge.new(chainID, [owner], 1, 0, 100).send({ from: accounts[0] });
    await finder.methods.changeImplementationAddress(utf8ToHex(interfaceName.Bridge), bridge.options.address);
    sinkGovernor = await SinkGovernor.new(finder.options.address).send({ from: accounts[0] });
    sinkGovernorResourceId = getResourceId(chainID);
    handler = await GenericHandler.new(
      bridge.options.address,
      [sinkGovernorResourceId],
      [sinkGovernor.options.address],
      [blankFunctionSig],
      [blankFunctionSig]
    ).send({ from: accounts[0] });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.GenericHandler), handler.options.address)
      .send({ from: accounts[0] });
    await bridge.methods
      .adminSetGenericResource(
        handler.options.address,
        sinkGovernorResourceId,
        sinkGovernor.options.address,
        blankFunctionSig,
        getFunctionSignature(SinkGovernor, "executeGovernance")
      )
      .send({ from: owner });

    erc20 = await ERC20.new("Test Token", "TEST", 18).send({ from: accounts[0] });
    await erc20.methods.addMember(1, owner).send({ from: accounts[0] });
    await erc20.methods.mint(sinkGovernor.options.address, web3.utils.toWei("1")).send({ from: accounts[0] });
  });
  it("construction", async function () {
    assert.equal(await sinkGovernor.methods.finder().call(), finder.options.address, "finder not set");
  });
  it("executeGovernance", async function () {
    const innerTransactionCalldata = erc20.methods.transfer(rando, web3.utils.toWei("1")).encodeABI();

    assert(
      await didContractThrow(
        sinkGovernor.methods.executeGovernance(erc20.options.address, innerTransactionCalldata).send({ from: rando })
      ),
      "Only callable by GenericHandler"
    );

    const depositData = web3.eth.abi.encodeParameters(
      ["address", "bytes"],
      [erc20.options.address, innerTransactionCalldata]
    );
    const genericDepositData = createGenericDepositData(depositData);
    const dataHash = web3.utils.soliditySha3(
      { t: "address", v: handler.options.address },
      { t: "bytes", v: genericDepositData }
    );

    await bridge.methods
      .voteProposal(chainID, expectedDepositNonce, sinkGovernorResourceId, dataHash)
      .send({ from: accounts[0] });
    await bridge.methods
      .executeProposal(chainID, expectedDepositNonce, genericDepositData, sinkGovernorResourceId)
      .send({ from: accounts[0] });

    assert.equal((await erc20.methods.balanceOf(rando).call()).toString(), web3.utils.toWei("1"));
    assert.equal((await erc20.methods.balanceOf(sinkGovernor.options.address).call()).toString(), "0");
  });
});
