import winston from "winston";
import { assert, web3 } from "hardhat";
import { Contract } from "web3-eth-contract";
import sinon from "sinon";
import { run } from "../src/index";
import { getTruffleContract } from "@uma/core";
import { addGlobalHardhatTestingAddress, interfaceName, ZERO_ADDRESS, RegistryRolesEnum } from "@uma/common";

import { SpyTransport } from "@uma/financial-templates-lib";

const { utf8ToHex } = web3.utils;
const Finder = getTruffleContract("Finder", web3);
const OracleChildTunnel = getTruffleContract("OracleChildTunnel", web3);
const Registry = getTruffleContract("Registry", web3);
const OracleRootTunnel = getTruffleContract("OracleRootTunnelMock", web3);
const MockOracle = getTruffleContract("MockOracleAncillary", web3);
const StateSync = getTruffleContract("StateSyncMock", web3);
const FxChild = getTruffleContract("FxChildMock", web3);
const FxRoot = getTruffleContract("FxRootMock", web3);

let spyLogger: any;
let spy: any;
let systemSuperUser: string;
let checkpointManager: string;
let owner: any;
let originalEnv: any;

// Contracts
let finder: any;
let oracleChild: Contract;
let oracleRoot: Contract;
let registry: any;
let mockOracle: any;
let stateSync: any;
let fxRoot: any;
let fxChild: any;

describe("index.ts", function () {
  after(async function () {
    process.env = originalEnv;
  });
  before(async function () {
    [owner, systemSuperUser, checkpointManager] = await web3.eth.getAccounts();
    originalEnv = process.env;

    // Note: We deploy all contracts on local hardhat network to make testing more convenient.

    // Set up mocked Fx tunnel:
    stateSync = await StateSync.new();
    fxRoot = await FxRoot.new(stateSync.address);
    fxChild = await FxChild.new(systemSuperUser);
    await fxChild.setFxRoot(fxRoot.address, { from: owner });
    await fxRoot.setFxChild(fxChild.address, { from: owner });

    // Set up mocked Oracle infrastructure
    finder = await Finder.new();
    mockOracle = await MockOracle.new(finder.address, ZERO_ADDRESS);
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.address);
    registry = await Registry.new();
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.Registry), registry.address);
    await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, owner, { from: owner });
    await registry.registerContract([], owner, { from: owner });
  });
  beforeEach(async function () {
    // Deploy new tunnel contracts so that event logs are fresh for each test
    const _oracleChild = await OracleChildTunnel.new(fxChild.address, finder.address);
    const _oracleRoot = await OracleRootTunnel.new(checkpointManager, fxRoot.address, finder.address);
    await _oracleChild.setFxRootTunnel(_oracleRoot.address, { from: owner });
    await _oracleRoot.setFxChildTunnel(_oracleChild.address, { from: owner });

    // Create Web3.eth.Contract versions of Tunnel contracts so that we can interact with them the same way
    // that the relayer bot does.
    oracleChild = new web3.eth.Contract(OracleChildTunnel.abi, _oracleChild.address);
    addGlobalHardhatTestingAddress("OracleChildTunnel", oracleChild.options.address);
    oracleRoot = new web3.eth.Contract(OracleRootTunnel.abi, _oracleRoot.address);
    addGlobalHardhatTestingAddress("OracleRootTunnel", oracleRoot.options.address);

    spy = sinon.spy();
    spyLogger = winston.createLogger({
      level: "debug",
      transports: [new SpyTransport({ level: "debug" }, { spy: spy })],
    });
  });

  it("Runs with no errors", async function () {
    process.env.POLLING_DELAY = "0";

    // Must not throw.
    await run(spyLogger, web3);
    assert.isTrue(
      spy.getCall(-2).lastArg.message.includes("No MessageSent events emitted by OracleChildTunnel, exiting")
    );
  });
});
