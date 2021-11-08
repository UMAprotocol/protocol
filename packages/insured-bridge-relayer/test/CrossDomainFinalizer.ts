import {
  SpyTransport,
  InsuredBridgeL1Client,
  InsuredBridgeL2Client,
  lastSpyLogIncludes,
  GasEstimator,
  RateModel,
} from "@uma/financial-templates-lib";
import winston from "winston";
import sinon from "sinon";
import hre from "hardhat";
const { assert } = require("chai");

import { interfaceName, TokenRolesEnum, HRE, ZERO_ADDRESS } from "@uma/common";

const { web3, getContract } = hre as HRE;
const { toWei, toBN, utf8ToHex } = web3.utils;
const toBNWei = (number: string | number) => toBN(toWei(number.toString()).toString());

// Helper contracts
const Messenger = getContract("MessengerMock");
const BridgePool = getContract("BridgePool");
const BridgeAdmin = getContract("BridgeAdmin");
const BridgeDepositBox = getContract("BridgeDepositBoxMock");
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
let l1Timer: any;
let l2Timer: any;
let optimisticOracle: any;
let l1Token: any;
let l2Token: any;
let mockOracle: any;

// Hard-coded test params:
const chainId = 10;
const defaultGasLimit = 1_000_000;
const defaultGasPrice = toWei("1", "gwei");
const defaultIdentifier = utf8ToHex("IS_CROSS_CHAIN_RELAY_VALID");
const defaultLiveness = 100;
const lpFeeRatePerSecond = toWei("0.0000015");
const finalFee = toWei("1");
const defaultProposerBondPct = toWei("0.05");
const defaultSlowRelayFeePct = toWei("0.05");
const defaultInstantRelayFeePct = toWei("0.05");
const minimumBridgingDelay = 60; // L2->L1 token bridging must wait at least this time.
const initialPoolLiquidity = toWei("100");
const depositAmount = toWei("1");
const rateModel: RateModel = { UBar: toBNWei("0.65"), R0: toBNWei("0.00"), R1: toBNWei("0.08"), R2: toBNWei("1.00") };

import { CrossDomainFinalizer } from "../src/CrossDomainFinalizer";

describe("CrossDomainFinalizer.ts", function () {
  let l1Accounts;
  let l1Owner: string;
  let l1Relayer: any;
  let l1LiquidityProvider: any;

  let l2Owner: any;
  let l2Depositor: any;
  let l2BridgeAdminImpersonator: any;

  let spyLogger: any;
  let spy: any;

  let crossDomainFinalizer: any;
  let l1Client: any;
  let l2Client: any;
  let gasEstimator: any;

  before(async function () {
    l1Accounts = await web3.eth.getAccounts();
    [l1Owner, l1Relayer, l1LiquidityProvider, l2Owner, l2Depositor, l2BridgeAdminImpersonator] = l1Accounts;

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

    // Other contract setup needed to relay deposit:
    await identifierWhitelist.methods.addSupportedIdentifier(defaultIdentifier).send({ from: l1Owner });
  });

  beforeEach(async function () {
    // Deploy new contracts with clean state and perform setup:
    l1Timer = await Timer.new().send({ from: l1Owner });
    store = await Store.new({ rawValue: "0" }, { rawValue: "0" }, l1Timer.options.address).send({ from: l1Owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Store), store.options.address)
      .send({ from: l1Owner });

    l1Token = await ERC20.new("TESTERC20", "TESTERC20", 18).send({ from: l1Owner });
    await l1Token.methods.addMember(TokenRolesEnum.MINTER, l1Owner).send({ from: l1Owner });
    await collateralWhitelist.methods.addToWhitelist(l1Token.options.address).send({ from: l1Owner });
    await store.methods.setFinalFee(l1Token.options.address, { rawValue: finalFee }).send({ from: l1Owner });

    // Deploy new OptimisticOracle so that we can control its timing:
    optimisticOracle = await OptimisticOracle.new(
      defaultLiveness,
      finder.options.address,
      l1Timer.options.address
    ).send({ from: l1Owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.SkinnyOptimisticOracle), optimisticOracle.options.address)
      .send({ from: l1Owner });

    // Deploy new MockOracle so that OptimisticOracle disputes can make price requests to it:
    mockOracle = await MockOracle.new(finder.options.address, l1Timer.options.address).send({ from: l1Owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.options.address)
      .send({ from: l1Owner });

    // Deploy and setup BridgeAdmin:
    messenger = await Messenger.new().send({ from: l1Owner });
    bridgeAdmin = await BridgeAdmin.new(
      finder.options.address,
      defaultLiveness,
      defaultProposerBondPct,
      defaultIdentifier
    ).send({ from: l1Owner });

    // Deploy the l2Timer, Deposit box and l2Token on the second web3 instance from ganache.
    l2Timer = await Timer.new().send({ from: l2Owner });

    bridgeDepositBox = await BridgeDepositBox.new(
      l2BridgeAdminImpersonator,
      minimumBridgingDelay,
      ZERO_ADDRESS,
      l2Timer.options.address
    ).send({ from: l2Owner });

    l2Token = await ERC20.new("L2ERC20", "L2ERC20", 18).send({ from: l2Owner });
    await l2Token.methods.addMember(TokenRolesEnum.MINTER, l2Owner).send({ from: l2Owner });

    await bridgeAdmin.methods
      .setDepositContract(chainId, bridgeDepositBox.options.address, messenger.options.address)
      .send({ from: l1Owner });
    // New BridgePool linked to BridgeAdmin
    bridgePool = await BridgePool.new(
      "LP Token",
      "LPT",
      bridgeAdmin.options.address,
      l1Token.options.address,
      lpFeeRatePerSecond,
      false,
      l1Timer.options.address
    ).send({ from: l1Owner });

    // Add L1-L2 token mapping. Note that we need to whitelist on both the L1 and L2 side because the L1 mapping
    // is used by the bots to fetch bridge pool addresses.
    await bridgeAdmin.methods
      .whitelistToken(
        chainId,
        l1Token.options.address,
        l2Token.options.address,
        bridgePool.options.address,
        0,
        defaultGasLimit,
        defaultGasPrice,
        0
      )
      .send({ from: l1Owner });

    l1DeployData = {
      [l1Token.options.address]: {
        timestamp: (await l1Timer.methods.getCurrentTime().call()).toString(),
      },
    };
    l2DeployData = {
      [chainId]: {
        blockNumber: await web3.eth.getBlockNumber(),
      },
    };

    await bridgeDepositBox.methods
      .whitelistToken(l1Token.options.address, l2Token.options.address, bridgePool.options.address)
      .send({ from: l2BridgeAdminImpersonator });

    spy = sinon.spy();
    spyLogger = winston.createLogger({
      level: "debug",
      transports: [new SpyTransport({ level: "debug" }, { spy: spy })],
    });

    // Create the rate models for the one and only l1Token, set to the single rateModel defined in the constants.
    const rateModels = { [l1Token.options.address]: rateModel };
    l1Client = new InsuredBridgeL1Client(spyLogger, web3, bridgeAdmin.options.address, rateModels);
    l2Client = new InsuredBridgeL2Client(spyLogger, web3, bridgeDepositBox.options.address, chainId);

    gasEstimator = new GasEstimator(spyLogger);
    crossDomainFinalizer = new CrossDomainFinalizer(spyLogger, gasEstimator, l1Client, l2Client, l1Relayer);
  });
  describe("L2->L1 cross-domain transfers over the canonical bridge", () => {
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
    it("Can correctly detect and cross-domain transfers", async function () {
      // Before any should do nothing and log accordingly.
      await Promise.all([l1Client.update(), l2Client.update()]);

      await crossDomainFinalizer.checkForBridgeableL2TokensAndBridge();
      assert.isTrue(lastSpyLogIncludes(spy, "No bridgeable L2 tokens"));

      // Now, make a deposit to the L2 contract.
      const depositTime = await bridgeDepositBox.methods.getCurrentTime().call();
      await l2Token.methods.approve(bridgeDepositBox.options.address, depositAmount).send({ from: l2Depositor });
      await bridgeDepositBox.methods
        .deposit(
          l2Depositor,
          l2Token.options.address,
          depositAmount,
          defaultSlowRelayFeePct,
          defaultInstantRelayFeePct,
          depositTime
        )
        .send({ from: l2Depositor });

      // Tokens should not yet be bridgeable as not enough time has passed.
      assert.isFalse(await bridgeDepositBox.methods.canBridge(l2Token.options.address).call());

      await crossDomainFinalizer.checkForBridgeableL2TokensAndBridge();
      assert.isTrue(lastSpyLogIncludes(spy, "No bridgeable L2 tokens"));

      // Now, advance time such that the L2->L1 token bridging action should be enabled.
      console.log("depositTime", depositTime);
      await l2Timer.methods.setCurrentTime(Number(depositTime) + minimumBridgingDelay + 1).send({ from: l1Owner });

      // Token should show up as bridgeable.
      assert.isTrue(await bridgeDepositBox.methods.canBridge(l2Token.options.address).call());

      // Now, when running the cross-domain finalizer, should send the L2->L1 transfer via the bridgeTokens method.
      console.log("await", (await l2Token.methods.balanceOf(bridgeDepositBox.options.address).call()).toString());
      await crossDomainFinalizer.checkForBridgeableL2TokensAndBridge();
      assert.isTrue(lastSpyLogIncludes(spy, "L2 L2ERC20 bridged over the canonical bridge"));
      assert.isFalse(await bridgeDepositBox.methods.canBridge(l2Token.options.address).call());
    });
  });
});
