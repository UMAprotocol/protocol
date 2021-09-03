//zz

import { SpyTransport } from "@uma/financial-templates-lib";
import winston from "winston";
import sinon from "sinon";
import hre from "hardhat";

import {
  interfaceName,
  addGlobalHardhatTestingAddress,
  createConstructorParamsForContractVersion,
  HRE,
} from "@uma/common";

const { web3, getContract } = hre as HRE;
const { toWei, utf8ToHex, padRight } = web3.utils;

// Helper contracts
const BridgeAdmin = getContract("BridgeAdmin");
const Finder = getContract("Finder");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const AddressWhitelist = getContract("AddressWhitelist");
const OptimisticOracle = getContract("OptimisticOracle");
const Store = getContract("Store");
const ERC20 = getContract("ExpandedERC20");
const Timer = getContract("Timer");
const MockOracle = getContract("MockOracleAncillary");

// Contract objects
let bridgeAdmin;
let bridgePool;
let finder;
let store;
let identifierWhitelist;
let collateralWhitelist;
let l1CrossDomainMessengerMock;
let timer;
let optimisticOracle;
let l1Token;
let l2Token;
let lpToken;
let mockOracle;

// Tested file
import { run } from "../src/index";

describe("index.js", function () {
  let spyLogger: any;
  let spy: any;
  let originalEnv: any;

  after(async function () {
    process.env = originalEnv;
  });
  before(async function () {
    originalEnv = process.env;

    // Deploy or fetch deployed contracts:
    finder = await Finder.new().send({ from: owner });
    collateralWhitelist = await AddressWhitelist.new().send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.CollateralWhitelist), collateralWhitelist.options.address)
      .send({ from: owner });

    identifierWhitelist = await IdentifierWhitelist.new().send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.IdentifierWhitelist), identifierWhitelist.options.address)
      .send({ from: owner });
    timer = await Timer.new().send({ from: owner });
    store = await Store.new({ rawValue: "0" }, { rawValue: "0" }, timer.options.address).send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Store), store.options.address)
      .send({ from: owner });

    // Other contract setup needed to relay deposit:
    await identifierWhitelist.methods.addSupportedIdentifier(defaultIdentifier).send({ from: owner });
  });

  beforeEach(async function () {
    spy = sinon.spy();
    spyLogger = winston.createLogger({
      level: "debug",
      transports: [new SpyTransport({ level: "debug" }, { spy: spy })],
    });
  });

  it("Runs with no errors", async function () {
    process.env.BRIDGE_ADMIN_ADDRESS = "0x0000000000000000000000000000000000000000";

    process.env.POLLING_DELAY = "0";

    // Must not throw.
    await run(spyLogger, web3);
  });
});
