const { assert } = require("chai");
const { ZERO_ADDRESS, interfaceName, RegistryRolesEnum } = require("@uma/common")

const { utf8ToHex } = web3.utils;

const StateSync = artifacts.require("StateSyncMock");
const FxChild = artifacts.require("FxChildMock");
const FxRoot = artifacts.require("FxRootMock");
const OracleChildTunnel = artifacts.require("OracleChildTunnel");
const OracleRootTunnel = artifacts.require("OracleRootTunnel");
const Finder = artifacts.require("Finder");
const Registry = artifacts.require("Registry");
const MockOracle = artifacts.require("MockOracleAncillary");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");

contract("Polygon <> Ethereum Tunnel: End-to-End Test", async (accounts) => {
  const owner = accounts[0];
  const systemSuperUser = accounts[1];

  let stateSync;
  let fxChild;
  let fxRoot;
  let oracleChild;
  let oracleRoot;

  // Oracle system:
  let finder;
  let identifierWhitelist;
  let registry;
  let mockOracle;

  before(async function() {
    finder = await Finder.deployed();
    identifierWhitelist = await IdentifierWhitelist.deployed();
    registry = await Registry.deployed();
    mockOracle = await MockOracle.new(finder.address, ZERO_ADDRESS);

    await finder.changeImplementationAddress(utf8ToHex(interfaceName.Registry), registry.address);
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.address);
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.IdentifierWhitelist), identifierWhitelist.address);
  
    await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, owner);
    await registry.registerContract([], owner, { from: owner });
  })
  beforeEach(async function () {
    // Set up mocked Fx tunnel system:
    stateSync = await StateSync.new();
    fxRoot = await FxRoot.new(stateSync.address);
    fxChild = await FxChild.new(systemSuperUser);
    await fxChild.setFxRoot(fxRoot.address);
    await fxRoot.setFxChild(fxChild.address)

    // Set up Oracle tunnel system:
    oracleChild = await OracleChildTunnel.new(fxChild.address, finder.address)
    oracleRoot = await OracleRootTunnel.new(fxRoot.address, finder.address)

    // TODO: What to set as `checkpointManager` for oracleRoot???
  });
  it("test", async function () {
    assert(true)
  });
});
