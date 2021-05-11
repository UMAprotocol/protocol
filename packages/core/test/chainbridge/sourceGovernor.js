const { assert } = require("chai");
const { didContractThrow, interfaceName, RegistryRolesEnum } = require("@uma/common");
const SourceGovernor = artifacts.require("SourceGovernor");
const Finder = artifacts.require("Finder");
const Registry = artifacts.require("Registry");
const Bridge = artifacts.require("Bridge");
const GenericHandler = artifacts.require("GenericHandler");
const ERC20 = artifacts.require("ExpandedERC20");

const { utf8ToHex } = web3.utils;

const { blankFunctionSig, getFunctionSignature } = require("./helpers");

contract("SourceGovernor", async accounts => {
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

  const getResourceId = chainId => {
    const encodedParams = web3.eth.abi.encodeParameters(
      ["bytes32", "uint8"],
      [web3.utils.utf8ToHex("Governor"), chainId]
    );
    return web3.utils.soliditySha3(encodedParams);
  };

  before(async function() {
    registry = await Registry.deployed();
    await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, owner);
    await registry.registerContract([], owner, { from: owner });
    finder = await Finder.deployed();
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.Registry), registry.address);
  });
  beforeEach(async function() {
    bridge = await Bridge.new(chainID, [owner], 1, 0, 100);
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.Bridge), bridge.address);
    sourceGovernor = await SourceGovernor.new(finder.address, chainID);
    sourceGovernorResourceId = getResourceId(chainID);
    handler = await GenericHandler.new(
      bridge.address,
      [sourceGovernorResourceId],
      [sourceGovernor.address],
      [getFunctionSignature(sourceGovernor, "verifyRequest")],
      [blankFunctionSig]
    );
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.GenericHandler), handler.address);
    await bridge.adminSetGenericResource(
      handler.address,
      sourceGovernorResourceId,
      sourceGovernor.address,
      getFunctionSignature(sourceGovernor, "verifyRequest"),
      blankFunctionSig,
      { from: owner }
    );

    erc20 = await ERC20.new("Test Token", "TEST", 18);
    await erc20.addMember(1, owner);
    await erc20.mint(sourceGovernor.address, web3.utils.toWei("1"));
  });
  it("construction", async function() {
    assert.equal(await sourceGovernor.finder(), finder.address, "finder not set");
  });
  it("resource id", async function() {
    assert.equal(await sourceGovernor.getResourceId(), getResourceId(chainID), "resource id not computed correctly");
  });
  it("relayGovernor", async function() {
    const innerTransactionCalldata = erc20.contract.methods.transfer(rando, web3.utils.toWei("1")).encodeABI();
    const depositData = web3.eth.abi.encodeParameters(
      ["address", "uint256", "bytes"],
      [erc20.address, "0", innerTransactionCalldata]
    );

    assert(
      await didContractThrow(
        sourceGovernor.relayGovernance(destinationChainID, erc20.address, "0", innerTransactionCalldata, {
          from: rando
        })
      ),
      "Only callable by GenericHandler"
    );

    await sourceGovernor.relayGovernance(destinationChainID, erc20.address, "0", innerTransactionCalldata, {
      from: owner
    });

    const { _destinationChainID, _depositer, _resourceID, _metaData } = await handler._depositRecords(
      destinationChainID,
      expectedDepositNonce
    );

    assert.equal(_destinationChainID.toString(), destinationChainID.toString());
    assert.equal(_depositer, sourceGovernor.address);
    assert.equal(_resourceID, sourceGovernorResourceId);
    assert.equal(_metaData, depositData);
  });
});
