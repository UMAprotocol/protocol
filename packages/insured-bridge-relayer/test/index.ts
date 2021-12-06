import { SpyTransport } from "@uma/financial-templates-lib";
import winston from "winston";
import sinon from "sinon";
import hre from "hardhat";
const { assert } = require("chai");
const Web3 = require("web3");
const ganache = require("ganache-core");

import { interfaceName, TokenRolesEnum, HRE, ZERO_ADDRESS } from "@uma/common";

const { web3, getContract } = hre as HRE;
const { toWei, toBN, utf8ToHex, toChecksumAddress, randomHex } = web3.utils;
const toBNWei = (number: string | number) => toBN(toWei(number.toString()).toString());

let l2Web3: typeof Web3 = undefined;
const startGanacheServer = (chainId: number, port: number) => {
  if (l2Web3 !== undefined) return;
  const node = ganache.server({ _chainIdRpc: chainId });
  node.listen(port);
  l2Web3 = new Web3("http://127.0.0.1:" + port);
};

// Helper contracts
const chainId = 10;
const Messenger = getContract("MessengerMock");
const BridgePool = getContract("BridgePool");
const BridgeDepositBox = getContract("BridgeDepositBoxMock");
const BridgeAdmin = getContract("BridgeAdmin");
const Finder = getContract("Finder");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const AddressWhitelist = getContract("AddressWhitelist");
const OptimisticOracle = getContract("SkinnyOptimisticOracle");
const Store = getContract("Store");
const ERC20 = getContract("ExpandedERC20");
const Timer = getContract("Timer");
const MockOracle = getContract("MockOracleAncillary");

// Contract objects
let messenger: any;
let bridgeAdmin: any;
let bridgePool: any;
let bridgeDepositBox: any;
let finder: any;
let store: any;
let identifierWhitelist: any;
let collateralWhitelist: any;
let timer: any;
let optimisticOracle: any;
let l1Token: any;
let l2Token: any;
let mockOracle: any;

// Hard-coded test params:
const defaultGasLimit = 1_000_000;
const defaultGasPrice = toWei("1", "gwei");
const defaultIdentifier = utf8ToHex("IS_CROSS_CHAIN_RELAY_VALID");
const defaultLiveness = 100;
const lpFeeRatePerSecond = toWei("0.0000015");
const finalFee = toWei("1");
const defaultProposerBondPct = toWei("0.05");
const minimumBridgingDelay = 60; // L2->L1 token bridging must wait at least this time.

// Tested file
import { run } from "../src/index";

describe("index.js", function () {
  let accounts;
  let owner: string;
  let spyLogger: any;
  let spy: any;
  let originalEnv: any;

  after(async function () {
    process.env = originalEnv;
  });
  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, l2Token] = accounts;
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
      .changeImplementationAddress(utf8ToHex(interfaceName.SkinnyOptimisticOracle), optimisticOracle.options.address)
      .send({ from: owner });

    // Deploy new MockOracle so that OptimisticOracle disputes can make price requests to it:
    mockOracle = await MockOracle.new(finder.options.address, timer.options.address).send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.options.address)
      .send({ from: owner });

    // Deploy and setup BridgeAdmin:
    messenger = await Messenger.new().send({ from: owner });
    bridgeAdmin = await BridgeAdmin.new(
      finder.options.address,
      defaultLiveness,
      defaultProposerBondPct,
      defaultIdentifier
    ).send({ from: owner });

    // New BridgePool linked to BridgeAdmin
    bridgePool = await BridgePool.new(
      "LP Token",
      "LPT",
      bridgeAdmin.options.address,
      l1Token.options.address,
      lpFeeRatePerSecond,
      false,
      timer.options.address
    ).send({ from: owner });

    spy = sinon.spy();
    spyLogger = winston.createLogger({
      level: "debug",
      transports: [new SpyTransport({ level: "debug" }, { spy: spy })],
    });

    startGanacheServer(chainId, 7777);
    const [l2Owner, l2BridgeAdminImpersonator] = await l2Web3.eth.getAccounts();

    // Deploy deposit box on L2 web3 so that L2 client can read its events.
    const L2BridgeDepositBox = new l2Web3.eth.Contract(BridgeDepositBox.abi);
    bridgeDepositBox = await L2BridgeDepositBox.deploy({
      data: BridgeDepositBox.bytecode,
      arguments: [l2BridgeAdminImpersonator, minimumBridgingDelay, ZERO_ADDRESS, ZERO_ADDRESS],
    }).send({
      from: l2Owner,
      gas: 6000000,
      gasPrice: toWei("1", "gwei"),
    });

    await bridgeAdmin.methods
      .setDepositContract(chainId, bridgeDepositBox.options.address, messenger.options.address)
      .send({ from: owner });

    // Add L1-L2 token mapping after deposit box address is set.
    await bridgeAdmin.methods
      .whitelistToken(
        chainId,
        l1Token.options.address,
        l2Token,
        bridgePool.options.address,
        0,
        defaultGasLimit,
        defaultGasPrice,
        0
      )
      .send({ from: owner });
    await bridgeDepositBox.methods
      .whitelistToken(l1Token.options.address, l2Token, bridgePool.options.address)
      .send({ from: l2BridgeAdminImpersonator });
  });
  it("Runs with no errors and correctly sets approvals for whitelisted L1 tokens", async function () {
    process.env.BRIDGE_ADMIN_ADDRESS = bridgeAdmin.options.address;
    process.env.RELAYER_ENABLED = "1";
    process.env.DISPUTER_ENABLED = "1";
    process.env.FINALIZER_ENABLED = "1";
    process.env.POLLING_DELAY = "0";
    process.env.RATE_MODELS = JSON.stringify({
      [l1Token.options.address]: {
        UBar: toBNWei("0.65"),
        R0: toBNWei("0.00"),
        R1: toBNWei("0.08"),
        R2: toBNWei("1.00"),
      },
    });
    process.env.CHAIN_IDS = JSON.stringify([chainId]);
    process.env[`NODE_URL_${chainId}`] = "http://localhost:7777";

    // Must not throw.
    await run(spyLogger, web3);

    // Approvals are set correctly
    assert.notEqual((await l1Token.methods.allowance(owner, bridgePool.options.address)).toString(), "0");
  });
  it("Filters L1 token whitelist on L2 whitelist events", async function () {
    process.env.BRIDGE_ADMIN_ADDRESS = bridgeAdmin.options.address;
    process.env.RELAYER_ENABLED = "1";
    process.env.DISPUTER_ENABLED = "1";
    process.env.FINALIZER_ENABLED = "1";
    process.env.POLLING_DELAY = "0";

    // Add another L1 token to rate model that is not whitelisted.
    const unWhitelistedL1Token = toChecksumAddress(randomHex(20));
    process.env.RATE_MODELS = JSON.stringify({
      [l1Token.options.address]: {
        UBar: toBNWei("0.65"),
        R0: toBNWei("0.00"),
        R1: toBNWei("0.08"),
        R2: toBNWei("1.00"),
      },
      [unWhitelistedL1Token]: {
        UBar: toBNWei("0.75"),
        R0: toBNWei("0.00"),
        R1: toBNWei("0.06"),
        R2: toBNWei("2.00"),
      },
    });
    process.env.CHAIN_IDS = JSON.stringify([chainId]);
    process.env[`NODE_URL_${chainId}`] = "http://localhost:7777";

    // Must not throw.
    await run(spyLogger, web3);

    // Check logs for filtered whitelist, which should contain only the whitelisted L1 token.
    const targetLog = spy.getCalls().filter((_log: any) => {
      return _log.lastArg.message.includes("Filtered out tokens that are not whitelisted on L2");
    })[0];
    assert.equal(targetLog.lastArg.prunedWhitelist.length, 1);
    assert.equal(targetLog.lastArg.prunedWhitelist[0], l1Token.options.address);
  });
});
