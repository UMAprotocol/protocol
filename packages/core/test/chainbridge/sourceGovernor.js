const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract } = hre;
const { assert } = require("chai");
const { didContractThrow, interfaceName, RegistryRolesEnum } = require("@uma/common");
const SourceGovernor = getContract("SourceGovernor");
const Finder = getContract("Finder");
const Registry = getContract("Registry");
const Bridge = getContract("Bridge");
const GenericHandler = getContract("GenericHandler");
const ERC20 = getContract("ExpandedERC20");

const { utf8ToHex } = web3.utils;

const { blankFunctionSig, getFunctionSignature, createGenericDepositData } = require("./helpers");

contract("SourceGovernor", async (accounts) => {
  const owner = accounts[0];
  const rando = accounts[1];

  let sourceGovernor;
  let erc20;
  let registry;
  let finder;
  let bridge;
  let handler;

  const chainID = 1;
  const destinationChainID = 2;
  const expectedDepositNonce = 1;

  let sourceGovernorResourceId;

  const getResourceId = (chainId) => {
    const encodedParams = web3.eth.abi.encodeParameters(["string", "uint8"], ["Governor", chainId]);
    return web3.utils.soliditySha3(encodedParams);
  };

  beforeEach(async function () {
    await runDefaultFixture(hre);
    registry = await Registry.deployed();
    await registry.methods.addMember(RegistryRolesEnum.CONTRACT_CREATOR, owner).send({ from: accounts[0] });
    await registry.methods.registerContract([], owner).send({ from: owner });
    finder = await Finder.deployed();
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.Registry), registry.options.address);
    bridge = await Bridge.new(chainID, [owner], 1, 0, 100).send({ from: accounts[0] });
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.Bridge), bridge.options.address);
    sourceGovernor = await SourceGovernor.new(finder.options.address, chainID).send({ from: accounts[0] });
    sourceGovernorResourceId = getResourceId(chainID);
    handler = await GenericHandler.new(
      bridge.options.address,
      [sourceGovernorResourceId],
      [sourceGovernor.options.address],
      [getFunctionSignature(sourceGovernor, "verifyRequest")],
      [blankFunctionSig]
    );
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.GenericHandler), handler.options.address);
    await bridge.adminSetGenericResource(
      handler.options.address,
      sourceGovernorResourceId,
      sourceGovernor.options.address,
      getFunctionSignature(sourceGovernor, "verifyRequest"),
      blankFunctionSig,
      { from: owner }
    );

    erc20 = await ERC20.new("Test Token", "TEST", 18).send({ from: accounts[0] });
    await erc20.methods.addMember(1, owner).send({ from: accounts[0] });
    await erc20.methods.mint(sourceGovernor.options.address, web3.utils.toWei("1")).send({ from: accounts[0] });
  });
  it("construction", async function () {
    assert.equal(await sourceGovernor.methods.finder().call(), finder.options.address, "finder not set");
  });
  it("resource id", async function () {
    assert.equal(
      await sourceGovernor.methods.getResourceId().call(),
      getResourceId(chainID),
      "resource id not computed correctly"
    );
  });
  it("unauthorized request", async function () {
    const innerTransactionCalldata = erc20.contract.methods.transfer(rando, web3.utils.toWei("1")).encodeABI();
    const depositData = web3.eth.abi.encodeParameters(
      ["address", "bytes"],
      [erc20.options.address, innerTransactionCalldata]
    );

    assert(
      await didContractThrow(
        bridge.deposit(destinationChainID, sourceGovernorResourceId, createGenericDepositData(depositData))
      )
    );
  });
  it("relayGovernance", async function () {
    const innerTransactionCalldata = erc20.contract.methods.transfer(rando, web3.utils.toWei("1")).encodeABI();
    const depositData = web3.eth.abi.encodeParameters(
      ["address", "bytes"],
      [erc20.options.address, innerTransactionCalldata]
    );

    assert(
      await didContractThrow(
        sourceGovernor.methods
          .relayGovernance(destinationChainID, erc20.options.address, innerTransactionCalldata, { from: rando })
          .send({ from: accounts[0] })
      ),
      "Only callable by GenericHandler"
    );

    await sourceGovernor.methods
      .relayGovernance(destinationChainID, erc20.options.address, innerTransactionCalldata)
      .send({ from: owner });

    const { _destinationChainID, _depositer, _resourceID, _metaData } = await handler._depositRecords(
      destinationChainID,
      expectedDepositNonce
    );

    assert.equal(_destinationChainID.toString(), destinationChainID.toString());
    assert.equal(_depositer, sourceGovernor.options.address);
    assert.equal(_resourceID, sourceGovernorResourceId);
    assert.equal(_metaData, depositData);
  });
});
