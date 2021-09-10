import {
  SpyTransport,
  InsuredBridgeL1Client,
  InsuredBridgeL2Client,
  lastSpyLogIncludes,
  GasEstimator,
} from "@uma/financial-templates-lib";
const { predeploys } = require("@eth-optimism/contracts");
import winston from "winston";
import sinon from "sinon";
import hre from "hardhat";
const { assert } = require("chai");

import { interfaceName, TokenRolesEnum, HRE } from "@uma/common";

const { web3, getContract } = hre as HRE;
const { toWei, toBN, utf8ToHex } = web3.utils;

const { deployOptimismContractMock } = require("../../core/test/insured-bridge/helpers/SmockitHelper.js");

// Helper contracts
const BridgePool = getContract("BridgePool");
const BridgeAdmin = getContract("BridgeAdmin");
const BridgeDepositBox = getContract("OVM_BridgeDepositBox");
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
let bridgeDepositBox: any;
let finder: any;
let store: any;
let identifierWhitelist: any;
let collateralWhitelist: any;
let l1Timer: any;
let l2Timer: any;
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
const defaultSlowRelayFeePct = toWei("0.05");
// const defaultInstantRelayFeePct = toWei("0.05");
const minimumBridgingDelay = 60; // L2->L1 token bridging must wait at least this time.
const initialPoolLiquidity = toWei("100");
const depositAmount = toWei("1");

// Tested file
import { Relayer } from "../src/Relayer";

describe("Relayer.ts", function () {
  let l1Accounts;
  let l1Owner: string;
  let l1CrossDomainMessengerMock: any;
  let l1Relayer: any;
  let l1LiquidityProvider: any;

  let l2Owner: any;
  let l2Depositor: any;
  let l2CrossDomainMessengerMock: any;

  let spyLogger: any;
  let spy: any;

  let relayer: any;
  let l1Client: any;
  let l2Client: any;
  let gasEstimator: any;

  before(async function () {
    l1Accounts = await web3.eth.getAccounts();
    [l1Owner, l1Relayer, l1LiquidityProvider, l2Owner, l2Depositor] = l1Accounts;

    // Deploy or fetch deployed contracts:
    finder = await Finder.new().send({ from: l1Owner });
    collateralWhitelist = await AddressWhitelist.new().send({ from: l1Owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.CollateralWhitelist), collateralWhitelist.options.address)
      .send({ from: l1Owner });

    identifierWhitelist = await IdentifierWhitelist.new().send({ from: l1Owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.IdentifierWhitelist), identifierWhitelist.options.address)
      .send({ from: l1Owner });
    l1Timer = await Timer.new().send({ from: l1Owner });
    store = await Store.new({ rawValue: "0" }, { rawValue: "0" }, l1Timer.options.address).send({ from: l1Owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Store), store.options.address)
      .send({ from: l1Owner });

    // Other contract setup needed to relay deposit:
    await identifierWhitelist.methods.addSupportedIdentifier(defaultIdentifier).send({ from: l1Owner });
  });

  beforeEach(async function () {
    // Deploy new contracts with clean state and perform setup:
    l1Token = await ERC20.new("TESTERC20", "TESTERC20", 18).send({ from: l1Owner });
    await l1Token.methods.addMember(TokenRolesEnum.MINTER, l1Owner).send({ from: l1Owner });
    await collateralWhitelist.methods.addToWhitelist(l1Token.options.address).send({ from: l1Owner });
    await store.methods.setFinalFee(l1Token.options.address, { rawValue: finalFee }).send({ from: l1Owner });

    // Deploy new OptimisticOracle so that we can control its timing:
    // - Set initial liveness to something != `defaultLiveness` so we can test that the custom liveness is set
    //   correctly by the BridgePool.
    optimisticOracle = await OptimisticOracle.new(
      defaultLiveness * 10,
      finder.options.address,
      l1Timer.options.address
    ).send({ from: l1Owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.OptimisticOracle), optimisticOracle.options.address)
      .send({ from: l1Owner });

    // Deploy new MockOracle so that OptimisticOracle disputes can make price requests to it:
    mockOracle = await MockOracle.new(finder.options.address, l1Timer.options.address).send({ from: l1Owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.options.address)
      .send({ from: l1Owner });

    // Deploy and setup BridgeAdmin:
    l1CrossDomainMessengerMock = await deployOptimismContractMock("OVM_L1CrossDomainMessenger");
    bridgeAdmin = await BridgeAdmin.new(
      finder.options.address,
      l1CrossDomainMessengerMock.options.address,
      defaultLiveness,
      defaultProposerBondPct,
      defaultIdentifier
    ).send({ from: l1Owner });

    // Deploy the l2Timer, Deposit box and l2Token on the second web3 instance from ganache.
    l2Timer = await Timer.new().send({ from: l2Owner });

    bridgeDepositBox = await BridgeDepositBox.new(
      bridgeAdmin.options.address,
      minimumBridgingDelay,
      l2Timer.options.address
    ).send({ from: l2Owner });

    l2Token = await ERC20.new("L2ERC20", "L2ERC20", 18).send({ from: l2Owner });
    await l2Token.methods.addMember(TokenRolesEnum.MINTER, l2Owner).send({ from: l2Owner });

    await bridgeAdmin.methods.setDepositContract(bridgeDepositBox.options.address).send({ from: l1Owner });
    // New BridgePool linked to BridgeAdmin
    bridgePool = await BridgePool.new(
      "LP Token",
      "LPT",
      bridgeAdmin.options.address,
      l1Token.options.address,
      lpFeeRatePerSecond,
      l1Timer.options.address
    ).send({ from: l1Owner });

    // Add L1-L2 token mapping
    await bridgeAdmin.methods
      .whitelistToken(l1Token.options.address, l2Token.options.address, bridgePool.options.address, defaultGasLimit)
      .send({ from: l1Owner });

    l2CrossDomainMessengerMock = await deployOptimismContractMock("OVM_L2CrossDomainMessenger", {
      address: predeploys.OVM_L2CrossDomainMessenger,
    });
    await web3.eth.sendTransaction({ from: l2Owner, to: predeploys.OVM_L2CrossDomainMessenger, value: toWei("1") });
    l2CrossDomainMessengerMock.smocked.xDomainMessageSender.will.return.with(() => bridgeAdmin.options.address);
    await bridgeDepositBox.methods
      .whitelistToken(l1Token.options.address, l2Token.options.address, bridgePool.options.address)
      .send({ from: predeploys.OVM_L2CrossDomainMessenger });

    spy = sinon.spy();
    spyLogger = winston.createLogger({
      level: "debug",
      transports: [new SpyTransport({ level: "debug" }, { spy: spy })],
    });
    l1Client = new InsuredBridgeL1Client(spyLogger, web3, bridgeAdmin.options.address);
    l2Client = new InsuredBridgeL2Client(spyLogger, web3, bridgeDepositBox.options.address);

    gasEstimator = new GasEstimator(spyLogger);

    relayer = new Relayer(spyLogger, gasEstimator, l1Client, l2Client, [l1Token.options.address], l1Relayer);
  });
  it("Initialization is correct", async function () {
    assert.equal(relayer.l1Client.bridgeAdminAddress, bridgeAdmin.options.address);
    assert.equal(relayer.l2Client.bridgeDepositAddress, bridgeDepositBox.options.address);
  });
  describe("Basic relaying functionality", () => {
    beforeEach(async function () {
      // Add liquidity to the L1 pool to facilitate the relay action.
      await l1Token.methods.mint(l1LiquidityProvider, initialPoolLiquidity).send({ from: l1Owner });
      await l1Token.methods
        .approve(bridgePool.options.address, initialPoolLiquidity)
        .send({ from: l1LiquidityProvider });
      await bridgePool.methods.addLiquidity(initialPoolLiquidity).send({ from: l1LiquidityProvider });

      // Mint some tokens for the L2 depositor.
      await l2Token.methods.mint(l2Depositor, depositAmount).send({ from: l2Owner });
    });
    it("Can correctly detect relays on L2 and bring them over to L1", async function () {
      // Before any relays should do nothing and log accordingly.
      await Promise.all([l1Client.update(), l2Client.update()]);
      await relayer.checkForPendingDepositsAndRelay();
      assert.isTrue(lastSpyLogIncludes(spy, "No relayable deposits"));

      // Make a deposit on L2 and check the bot relays it accordingly.
      await l2Token.methods.approve(bridgeDepositBox.options.address, depositAmount).send({ from: l2Depositor });
      const currentBlockTime = await bridgeDepositBox.methods.getCurrentTime().call();
      await bridgeDepositBox.methods
        .deposit(
          l2Depositor,
          l2Token.options.address,
          depositAmount,
          defaultSlowRelayFeePct,
          "0", // set to zero to force the relayer to slow relay only
          currentBlockTime
        )
        .send({ from: l2Depositor });
      await Promise.all([l1Client.update(), l2Client.update()]);
      // As the relayer does not have enough token balance to do the relay (0 minted) should do nothing .
      await relayer.checkForPendingDepositsAndRelay();
      assert.isTrue(lastSpyLogIncludes(spy, "Not relaying deposit"));

      // Mint the relayer some tokens and try again.
      await l1Token.methods.mint(l1Relayer, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Relayer });
      await relayer.checkForPendingDepositsAndRelay();
      assert.isTrue(lastSpyLogIncludes(spy, "Slow Relay executed"));
    });
  });
});
