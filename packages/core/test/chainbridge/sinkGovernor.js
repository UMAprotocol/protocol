const { assert } = require("chai");
const { didContractThrow, interfaceName, RegistryRolesEnum } = require("@uma/common");
const SinkGovernor = artifacts.require("SinkGovernor");
const Finder = artifacts.require("Finder");
const Registry = artifacts.require("Registry");
const Bridge = artifacts.require("Bridge");
const GenericHandler = artifacts.require("GenericHandler");
const ERC20 = artifacts.require("ExpandedERC20");

const { utf8ToHex } = web3.utils;

const { blankFunctionSig, createGenericDepositData, getFunctionSignature } = require("./helpers");

contract("SinkGovernor", async (accounts) => {
  const owner = accounts[0];
  const rando = accounts[1];

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

  before(async function () {
    registry = await Registry.deployed();
    await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, owner);
    await registry.registerContract([], owner, { from: owner });
    finder = await Finder.deployed();
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.Registry), registry.address);
  });
  beforeEach(async function () {
    bridge = await Bridge.new(chainID, [owner], 1, 0, 100);
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.Bridge), bridge.address);
    sinkGovernor = await SinkGovernor.new(finder.address);
    sinkGovernorResourceId = getResourceId(chainID);
    handler = await GenericHandler.new(
      bridge.address,
      [sinkGovernorResourceId],
      [sinkGovernor.address],
      [blankFunctionSig],
      [blankFunctionSig]
    );
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.GenericHandler), handler.address);
    await bridge.adminSetGenericResource(
      handler.address,
      sinkGovernorResourceId,
      sinkGovernor.address,
      blankFunctionSig,
      getFunctionSignature(sinkGovernor, "executeGovernance"),
      { from: owner }
    );

    erc20 = await ERC20.new("Test Token", "TEST", 18);
    await erc20.addMember(1, owner);
    await erc20.mint(sinkGovernor.address, web3.utils.toWei("1"));
  });
  it("construction", async function () {
    assert.equal(await sinkGovernor.finder(), finder.address, "finder not set");
  });
  it("executeGovernance", async function () {
    const innerTransactionCalldata = erc20.contract.methods.transfer(rando, web3.utils.toWei("1")).encodeABI();

    assert(
      await didContractThrow(sinkGovernor.executeGovernance(erc20.address, innerTransactionCalldata, { from: rando })),
      "Only callable by GenericHandler"
    );

    const depositData = web3.eth.abi.encodeParameters(["address", "bytes"], [erc20.address, innerTransactionCalldata]);
    const genericDepositData = createGenericDepositData(depositData);
    const dataHash = web3.utils.soliditySha3(
      { t: "address", v: handler.address },
      { t: "bytes", v: genericDepositData }
    );

    await bridge.voteProposal(chainID, expectedDepositNonce, sinkGovernorResourceId, dataHash);
    await bridge.executeProposal(chainID, expectedDepositNonce, genericDepositData, sinkGovernorResourceId);

    assert.equal((await erc20.balanceOf(rando)).toString(), web3.utils.toWei("1"));
    assert.equal((await erc20.balanceOf(sinkGovernor.address)).toString(), "0");
  });
});
