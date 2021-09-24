import { SpyTransport } from "@uma/financial-templates-lib";
import winston from "winston";
import sinon from "sinon";
import hre from "hardhat";
const { assert } = require("chai");

import { interfaceName, TokenRolesEnum, HRE } from "@uma/common";

// TODO: clean up this export/import path
const { deployContractMock } = require("../../core/test/insured-bridge/helpers/SmockitHelper.js");

const { web3, getContract } = hre as HRE;
const { toWei, utf8ToHex } = web3.utils;

// Helper contracts
const BridgePool = getContract("BridgePool");
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
let bridgeAdmin: any;
let bridgePool: any;
let finder: any;
let store: any;
let identifierWhitelist: any;
let collateralWhitelist: any;
let l1CrossDomainMessengerMock: any;
let timer: any;
let optimisticOracle: any;
let l1Token: any;
let l2Token: any;
let mockOracle: any;

// Hard-coded test params:
const defaultGasLimit = 1_000_000;
const defaultIdentifier = utf8ToHex("IS_CROSS_CHAIN_RELAY_VALID");
const defaultLiveness = 100;
const lpFeeRatePerSecond = toWei("0.0000015");
const finalFee = toWei("1");
const defaultProposerBondPct = toWei("0.05");

// Tested file
import { run } from "../src/index";

describe("index.js", function () {
  let accounts;
  let owner: string;
  let depositContractImpersonator: string;
  let spyLogger: any;
  let spy: any;
  let originalEnv: any;

  after(async function () {
    process.env = originalEnv;
  });
  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, l2Token, depositContractImpersonator] = accounts;
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
    // Deploy new contracts with clean state and perform setup:
    l1Token = await ERC20.new("TESTERC20", "TESTERC20", 18).send({ from: owner });
    await l1Token.methods.addMember(TokenRolesEnum.MINTER, owner).send({ from: owner });
    await collateralWhitelist.methods.addToWhitelist(l1Token.options.address).send({ from: owner });
    await store.methods.setFinalFee(l1Token.options.address, { rawValue: finalFee }).send({ from: owner });

    // Deploy new OptimisticOracle so that we can control its timing:
    // - Set initial liveness to something != `defaultLiveness` so we can test that the custom liveness is set
    //   correctly by the BridgePool.
    optimisticOracle = await OptimisticOracle.new(
      defaultLiveness * 10,
      finder.options.address,
      timer.options.address
    ).send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.OptimisticOracle), optimisticOracle.options.address)
      .send({ from: owner });

    // Deploy new MockOracle so that OptimisticOracle disputes can make price requests to it:
    mockOracle = await MockOracle.new(finder.options.address, timer.options.address).send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.options.address)
      .send({ from: owner });

    // Deploy and setup BridgeAdmin:
    l1CrossDomainMessengerMock = await deployContractMock("OVM_L1CrossDomainMessenger");
    bridgeAdmin = await BridgeAdmin.new(
      finder.options.address,
      l1CrossDomainMessengerMock.options.address,
      defaultLiveness,
      defaultProposerBondPct,
      defaultIdentifier
    ).send({ from: owner });
    await bridgeAdmin.methods.setDepositContract(depositContractImpersonator).send({ from: owner });

    // New BridgePool linked to BridgeAdmin
    bridgePool = await BridgePool.new(
      "LP Token",
      "LPT",
      bridgeAdmin.options.address,
      l1Token.options.address,
      lpFeeRatePerSecond,
      timer.options.address
    ).send({ from: owner });

    // Add L1-L2 token mapping
    await bridgeAdmin.methods
      .whitelistToken(l1Token.options.address, l2Token, bridgePool.options.address, defaultGasLimit)
      .send({ from: owner });

    spy = sinon.spy();
    spyLogger = winston.createLogger({
      level: "debug",
      transports: [new SpyTransport({ level: "debug" }, { spy: spy })],
    });
  });

  it("Runs with no errors and correctly sets approvals for whitelisted L1 tokens", async function () {
    process.env.BRIDGE_ADMIN_ADDRESS = bridgeAdmin.options.address;
    process.env.POLLING_DELAY = "0";
    process.env.WHITELISTED_L1_TOKENS = JSON.stringify([l1Token.options.address]);

    // Must not throw.
    await run(spyLogger, web3);

    // Approvals are set correctly
    assert.notEqual((await l1Token.methods.allowance(owner, bridgePool.options.address)).toString(), "0");
  });
});
