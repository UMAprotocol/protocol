import {
  SpyTransport,
  InsuredBridgeL1Client,
  InsuredBridgeL2Client,
  lastSpyLogIncludes,
  spyLogIncludes,
  GasEstimator,
} from "@uma/financial-templates-lib";
import { across } from "@uma/sdk";
import winston from "winston";
import sinon from "sinon";
import hre from "hardhat";
const { assert } = require("chai");

import { interfaceName, TokenRolesEnum, HRE, ZERO_ADDRESS } from "@uma/common";

// Tested module.
import { CrossDomainFinalizer } from "../src/CrossDomainFinalizer";

// Mocks.
import { BridgeAdapterMock } from "./mocks/BridgeAdapterMock";

const { web3, getContract } = hre as HRE;
const { toWei, toBN, utf8ToHex } = web3.utils;
const toBNWei = (number: string | number) => toBN(toWei(number.toString()).toString());

// Helper contracts
const Messenger = getContract("MessengerMock");
const Finder = getContract("Finder");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const AddressWhitelist = getContract("AddressWhitelist");
const OptimisticOracle = getContract("SkinnyOptimisticOracle");
const Store = getContract("Store");
const ERC20 = getContract("ExpandedERC20");
const Timer = getContract("Timer");
const MockOracle = getContract("MockOracleAncillary");

// Pull in contracts from contracts-node sourced from the across repo.
const { getAbi, getBytecode } = require("@uma/contracts-node");

const BridgeDepositBox = getContract("BridgeDepositBoxMock", {
  abi: getAbi("BridgeDepositBoxMock"),
  bytecode: getBytecode("BridgeDepositBoxMock"),
});

const BridgePool = getContract("BridgePool", {
  abi: getAbi("BridgePool"),
  bytecode: getBytecode("BridgePool"),
});

const BridgeAdmin = getContract("BridgeAdmin", {
  abi: getAbi("BridgeAdmin"),
  bytecode: getBytecode("BridgeAdmin"),
});

const RateModelStore = getContract("RateModelStore", {
  abi: getAbi("RateModelStore"),
  bytecode: getBytecode("RateModelStore"),
});

// Contract objects
let messenger: any;
let bridgeAdmin: any;
let bridgePool: any;
let bridgeDepositBox: any;
let rateModelStore: any;
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
let l1Token2: any;
let l2Token2: any;
let bridgePool2: any;
let l2DeployData: any;

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
const depositAmount = toBNWei("1");
const rateModel: across.constants.RateModel = {
  UBar: toWei("0.65"),
  R0: toWei("0.00"),
  R1: toWei("0.08"),
  R2: toWei("1.00"),
};
const crossDomainFinalizationThreshold = 5; // Only if there is more than 5% in L2 vs the L1 pool should we bridge.

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
  let bridgeAdapterMock: any;

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

    // Store the deployment block for the bridge deposit box.
    l2DeployData = {
      [chainId]: {
        blockNumber: await web3.eth.getBlockNumber(),
      },
    };

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
    rateModelStore = await RateModelStore.new().send({ from: l1Owner });
    await rateModelStore.methods
      .updateRateModel(
        l1Token.options.address,
        JSON.stringify({
          UBar: rateModels[l1Token.options.address].UBar.toString(),
          R0: rateModels[l1Token.options.address].R0.toString(),
          R1: rateModels[l1Token.options.address].R1.toString(),
          R2: rateModels[l1Token.options.address].R2.toString(),
        })
      )
      .send({ from: l1Owner });

    l1Client = new InsuredBridgeL1Client(spyLogger, web3, bridgeAdmin.options.address, rateModelStore.options.address);
    l2Client = new InsuredBridgeL2Client(spyLogger, web3, bridgeDepositBox.options.address, chainId);

    gasEstimator = new GasEstimator(spyLogger);

    bridgeAdapterMock = new BridgeAdapterMock(spyLogger, web3, web3);

    crossDomainFinalizer = new CrossDomainFinalizer(
      spyLogger,
      gasEstimator,
      l1Client,
      l2Client,
      bridgeAdapterMock,
      l1Relayer,
      l2DeployData,
      crossDomainFinalizationThreshold
    );
  });
  describe("L2->L1 cross-domain transfers over the canonical bridge: single token", () => {
    beforeEach(async function () {
      // Add liquidity to the L1 pool to facilitate the relay action.
      await l1Token.methods.mint(l1LiquidityProvider, toBN(initialPoolLiquidity).muln(2)).send({ from: l1Owner });
      await l1Token.methods
        .approve(bridgePool.options.address, toBN(initialPoolLiquidity).muln(2))
        .send({ from: l1LiquidityProvider });
      await bridgePool.methods.addLiquidity(initialPoolLiquidity).send({ from: l1LiquidityProvider });

      // Mint some tokens for the L2 depositor.
      await l2Token.methods.mint(l2Depositor, depositAmount.muln(10)).send({ from: l2Owner });
      await l2Token.methods
        .approve(bridgeDepositBox.options.address, depositAmount.muln(10))
        .send({ from: l2Depositor });
    });
    it("Can correctly detect and initiate cross-domain transfers", async function () {
      // Before any should do nothing and log accordingly.
      await Promise.all([l1Client.update(), l2Client.update()]);

      await crossDomainFinalizer.checkForBridgeableL2TokensAndBridge();
      assert.isTrue(lastSpyLogIncludes(spy, "No bridgeable L2 tokens"));

      // Now, make a deposit to the L2 contract.
      const depositTime = await bridgeDepositBox.methods.getCurrentTime().call();

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

      // Now, advance time such that the L2->L1 token bridging action should be enabled. However, we should still not
      // bridge as we are below the bridging threshold of 5%. The deposit amount is 1% of initial pool liquidity.
      await l2Timer.methods.setCurrentTime(Number(depositTime) + minimumBridgingDelay + 1).send({ from: l1Owner });
      await crossDomainFinalizer.checkForBridgeableL2TokensAndBridge();
      assert.isTrue(lastSpyLogIncludes(spy, "L2 balance <= cross domain finalization threshold % of L1 pool reserves"));

      // Token should show up as bridgeable, even though we chose not to bridge.
      assert.isTrue(await bridgeDepositBox.methods.canBridge(l2Token.options.address).call());

      // Now, deposit more to bring the amount of funds on L2 to > the cross-domain bridging threshold.
      await bridgeDepositBox.methods
        .deposit(
          l2Depositor,
          l2Token.options.address,
          depositAmount.muln(5),
          defaultSlowRelayFeePct,
          defaultInstantRelayFeePct,
          depositTime
        )
        .send({ from: l2Depositor });

      // Token should still show up as bridgeable.
      assert.isTrue(await bridgeDepositBox.methods.canBridge(l2Token.options.address).call());

      // Now, when running the cross-domain finalizer, should send the L2->L1 transfer via the bridgeTokens method.
      await crossDomainFinalizer.checkForBridgeableL2TokensAndBridge();
      assert.isTrue(lastSpyLogIncludes(spy, "Canonical bridge initiated"));
      assert.isFalse(await bridgeDepositBox.methods.canBridge(l2Token.options.address).call());
    });
    it("At high utilization cross domain transfers happens more quickly", async function () {
      // Do a relay to use 80% of the pools liquidity, pushing the utilization about the 75% threshold for higher L2->L1 transfers.
      const relayParams = {
        chainId: 10,
        depositId: 0,
        l1Recipient: l2Depositor,
        l2Sender: l2Depositor,
        amount: toBN(initialPoolLiquidity).muln(80).divn(100).toString(),
        slowRelayFeePct: defaultSlowRelayFeePct,
        instantRelayFeePct: defaultInstantRelayFeePct,
        quoteTimestamp: (await bridgePool.methods.getCurrentTime().call()).toString(),
      };
      console.log("relayParams", relayParams);
      await bridgePool.methods.relayDeposit(relayParams, toBNWei("0.1")).send({ from: l1LiquidityProvider });

      const liquidityUtilization = await bridgePool.methods.liquidityUtilizationCurrent().call();
      console.log("liquidityUtilization", liquidityUtilization.toString());

      assert.equal(liquidityUtilization.toString(), toWei("0.8"));

      // Now, add 1% of the total liquidity to the deposit box. No bridging should happen.
      const depositTime = await bridgeDepositBox.methods.getCurrentTime().call();
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

      await l2Timer.methods.setCurrentTime(Number(depositTime) + minimumBridgingDelay + 1).send({ from: l1Owner });
      await Promise.all([l1Client.update(), l2Client.update()]);
      await crossDomainFinalizer.checkForBridgeableL2TokensAndBridge();
      assert.isTrue(lastSpyLogIncludes(spy, "L2 balance <= cross domain finalization threshold % of L1 pool reserves"));

      // Next, if we increase the liquidity to be below the cross domain finalization threshold, but above the scaled
      // cross domain finalization threshold, we should see the action cross-domain action. I.e when utilization is
      // above 75%, we half the cross domain finalization threshold to send funds more aggressively when high util.
      // send another 2x depositAmount, putting the total on L2 at 3 Ether.
      await bridgeDepositBox.methods
        .deposit(
          l2Depositor,
          l2Token.options.address,
          depositAmount.muln(2),
          defaultSlowRelayFeePct,
          defaultInstantRelayFeePct,
          depositTime
        )
        .send({ from: l2Depositor });
      await crossDomainFinalizer.checkForBridgeableL2TokensAndBridge();
      assert.isTrue(lastSpyLogIncludes(spy, "Canonical bridge initiated"));
    });
  });
  describe("L2->L1 cross-domain transfers over the canonical bridge multi token", () => {
    beforeEach(async function () {
      // Add liquidity to the L1 pool to facilitate the relay action.
      await l1Token.methods.mint(l1LiquidityProvider, initialPoolLiquidity).send({ from: l1Owner });
      await l1Token.methods
        .approve(bridgePool.options.address, initialPoolLiquidity)
        .send({ from: l1LiquidityProvider });
      await bridgePool.methods.addLiquidity(initialPoolLiquidity).send({ from: l1LiquidityProvider });

      // Mint some tokens for the L2 depositor.
      await l2Token.methods.mint(l2Depositor, depositAmount.muln(10)).send({ from: l2Owner });
      await l2Token.methods
        .approve(bridgeDepositBox.options.address, depositAmount.muln(10))
        .send({ from: l2Depositor });

      // Create a second L2 token, L1 Bridge pool and whitelist accordingly.
      l1Token2 = await ERC20.new("L1ERC202", "L1ERC202", 18).send({ from: l1Owner });
      await collateralWhitelist.methods.addToWhitelist(l1Token2.options.address).send({ from: l1Owner });
      await store.methods.setFinalFee(l1Token2.options.address, { rawValue: finalFee }).send({ from: l1Owner });
      await l1Token2.methods.addMember(TokenRolesEnum.MINTER, l1Owner).send({ from: l1Owner });

      l2Token2 = await ERC20.new("L2ERC202", "L2ERC202", 18).send({ from: l2Owner });
      await l2Token2.methods.addMember(TokenRolesEnum.MINTER, l2Owner).send({ from: l2Owner });

      bridgePool2 = await BridgePool.new(
        "LP Token2",
        "LPT2",
        bridgeAdmin.options.address,
        l1Token2.options.address,
        lpFeeRatePerSecond,
        false,
        l1Timer.options.address
      ).send({ from: l1Owner });

      await bridgeAdmin.methods
        .whitelistToken(
          chainId,
          l1Token2.options.address,
          l2Token2.options.address,
          bridgePool2.options.address,
          0,
          defaultGasLimit,
          defaultGasPrice,
          0
        )
        .send({ from: l1Owner });

      await bridgeDepositBox.methods
        .whitelistToken(l1Token2.options.address, l2Token2.options.address, bridgePool2.options.address)
        .send({ from: l2BridgeAdminImpersonator });

      await l1Token2.methods.mint(l1LiquidityProvider, initialPoolLiquidity).send({ from: l1Owner });
      await l1Token2.methods
        .approve(bridgePool2.options.address, initialPoolLiquidity)
        .send({ from: l1LiquidityProvider });
      await bridgePool2.methods.addLiquidity(initialPoolLiquidity).send({ from: l1LiquidityProvider });

      // Mint some tokens for the L2 depositor.
      await l2Token2.methods.mint(l2Depositor, depositAmount.muln(10)).send({ from: l2Owner });
      await l2Token2.methods
        .approve(bridgeDepositBox.options.address, depositAmount.muln(10))
        .send({ from: l2Depositor });
    });
    it("Correctly sends both cross-chain bridging actions for both tokens", async function () {
      // Before any should do nothing and log accordingly.
      await Promise.all([l1Client.update(), l2Client.update()]);

      await crossDomainFinalizer.checkForBridgeableL2TokensAndBridge();
      assert.isTrue(lastSpyLogIncludes(spy, "No bridgeable L2 tokens"));

      // Now, make sufficient deposits on both pools to initiate bridging. deposit to the L2 contract.
      const depositTime = await bridgeDepositBox.methods.getCurrentTime().call();

      await bridgeDepositBox.methods
        .deposit(
          l2Depositor,
          l2Token.options.address,
          depositAmount.muln(6),
          defaultSlowRelayFeePct,
          defaultInstantRelayFeePct,
          depositTime
        )
        .send({ from: l2Depositor });

      await bridgeDepositBox.methods
        .deposit(
          l2Depositor,
          l2Token2.options.address,
          depositAmount.muln(6),
          defaultSlowRelayFeePct,
          defaultInstantRelayFeePct,
          depositTime
        )
        .send({ from: l2Depositor });

      // Tokens should not yet be bridgeable as not enough time has passed.
      assert.isFalse(await bridgeDepositBox.methods.canBridge(l2Token.options.address).call());
      assert.isFalse(await bridgeDepositBox.methods.canBridge(l2Token2.options.address).call());

      await crossDomainFinalizer.checkForBridgeableL2TokensAndBridge();
      assert.isTrue(lastSpyLogIncludes(spy, "No bridgeable L2 tokens"));

      // Now, advance time such that the L2->L1 token bridging action should be enabled.
      await l2Timer.methods.setCurrentTime(Number(depositTime) + minimumBridgingDelay + 1).send({ from: l1Owner });
      assert.isTrue(await bridgeDepositBox.methods.canBridge(l2Token.options.address).call());
      assert.isTrue(await bridgeDepositBox.methods.canBridge(l2Token2.options.address).call());
      await crossDomainFinalizer.checkForBridgeableL2TokensAndBridge();
      assert.isTrue(spyLogIncludes(spy, -1, "Canonical bridge initiated"));
      assert.isTrue(spyLogIncludes(spy, -1, "L2ERC202"));
      assert.isTrue(spyLogIncludes(spy, -3, "Canonical bridge initiated"));
      assert.isTrue(spyLogIncludes(spy, -3, "L2ERC20"));
      assert.isFalse(await bridgeDepositBox.methods.canBridge(l2Token.options.address).call());
      assert.isFalse(await bridgeDepositBox.methods.canBridge(l2Token2.options.address).call());
    });

    it("Correctly sends one cross-chain bridging action for one token above the threshold", async function () {
      await Promise.all([l1Client.update(), l2Client.update()]);
      // Make sufficient deposit for only one token to be bridged.
      const depositTime = await bridgeDepositBox.methods.getCurrentTime().call();

      await bridgeDepositBox.methods
        .deposit(
          l2Depositor,
          l2Token.options.address,
          depositAmount.muln(4),
          defaultSlowRelayFeePct,
          defaultInstantRelayFeePct,
          depositTime
        )
        .send({ from: l2Depositor });

      await bridgeDepositBox.methods
        .deposit(
          l2Depositor,
          l2Token2.options.address,
          depositAmount.muln(6),
          defaultSlowRelayFeePct,
          defaultInstantRelayFeePct,
          depositTime
        )
        .send({ from: l2Depositor });

      // Tokens should not yet be bridgeable as not enough time has passed.
      assert.isFalse(await bridgeDepositBox.methods.canBridge(l2Token.options.address).call());
      assert.isFalse(await bridgeDepositBox.methods.canBridge(l2Token2.options.address).call());

      await crossDomainFinalizer.checkForBridgeableL2TokensAndBridge();
      assert.isTrue(lastSpyLogIncludes(spy, "No bridgeable L2 tokens"));

      // Now, advance time such that the L2->L1 token bridging action should be enabled.
      await l2Timer.methods.setCurrentTime(Number(depositTime) + minimumBridgingDelay + 1).send({ from: l1Owner });
      assert.isTrue(await bridgeDepositBox.methods.canBridge(l2Token.options.address).call());
      assert.isTrue(await bridgeDepositBox.methods.canBridge(l2Token2.options.address).call());
      await crossDomainFinalizer.checkForBridgeableL2TokensAndBridge();
      // Logs should indicate that L2ERC202 was bridged but not L2ERC20
      assert.isTrue(spyLogIncludes(spy, -1, "Canonical bridge initiated"));
      assert.isTrue(spyLogIncludes(spy, -1, "L2ERC202"));
      assert.isTrue(spyLogIncludes(spy, -3, "L2 balance <= cross domain finalization threshold % of L1 pool reserves"));
      assert.isTrue(await bridgeDepositBox.methods.canBridge(l2Token.options.address).call());
      assert.isFalse(await bridgeDepositBox.methods.canBridge(l2Token2.options.address).call());
    });

    it("Correctly sends one cross-chain bridging actions for one can bridge token", async function () {
      await Promise.all([l1Client.update(), l2Client.update()]);
      // Make sufficient deposit for both one token to be bridged.
      const depositTime = await bridgeDepositBox.methods.getCurrentTime().call();

      await bridgeDepositBox.methods
        .deposit(
          l2Depositor,
          l2Token.options.address,
          depositAmount.muln(6),
          defaultSlowRelayFeePct,
          defaultInstantRelayFeePct,
          depositTime
        )
        .send({ from: l2Depositor });

      await bridgeDepositBox.methods
        .deposit(
          l2Depositor,
          l2Token2.options.address,
          depositAmount.muln(6),
          defaultSlowRelayFeePct,
          defaultInstantRelayFeePct,
          depositTime
        )
        .send({ from: l2Depositor });

      // Tokens should not yet be bridgeable as not enough time has passed.
      assert.isFalse(await bridgeDepositBox.methods.canBridge(l2Token.options.address).call());
      assert.isFalse(await bridgeDepositBox.methods.canBridge(l2Token2.options.address).call());

      await crossDomainFinalizer.checkForBridgeableL2TokensAndBridge();
      assert.isTrue(lastSpyLogIncludes(spy, "No bridgeable L2 tokens"));

      // Now, advance time such that the L2->L1 token bridging action should be enabled.
      await l2Timer.methods.setCurrentTime(Number(depositTime) + minimumBridgingDelay + 1).send({ from: l1Owner });
      assert.isTrue(await bridgeDepositBox.methods.canBridge(l2Token.options.address).call());
      assert.isTrue(await bridgeDepositBox.methods.canBridge(l2Token2.options.address).call());

      // Now, we will manually send the bridging action for one of the l1Tokens. The bot should detect this and
      // only try and bridge the other one.
      await bridgeDepositBox.methods.bridgeTokens(l2Token.options.address, "0").send({ from: l1Owner });
      assert.isFalse(await bridgeDepositBox.methods.canBridge(l2Token.options.address).call());

      await crossDomainFinalizer.checkForBridgeableL2TokensAndBridge();
      // Logs should indicate that L2ERC202 can be and was bridged, while L2ERC20 cannot be bridged so its threshold
      // is not even considered.
      assert.isTrue(spyLogIncludes(spy, -1, "Canonical bridge initiated"));
      assert.isTrue(spyLogIncludes(spy, -1, "L2ERC202"));
      assert.isTrue(spyLogIncludes(spy, -3, "Checking bridgeable L2 tokens"));
      assert.isFalse(await bridgeDepositBox.methods.canBridge(l2Token.options.address).call());
      assert.isFalse(await bridgeDepositBox.methods.canBridge(l2Token2.options.address).call());
    });
  });
  describe("L1 finalization for confirmed TokensBridged transactions", () => {
    beforeEach(async function () {
      // Add liquidity to the L1 pool to facilitate the relay action.
      await l1Token.methods.mint(l1LiquidityProvider, initialPoolLiquidity).send({ from: l1Owner });
      await l1Token.methods
        .approve(bridgePool.options.address, initialPoolLiquidity)
        .send({ from: l1LiquidityProvider });
      await bridgePool.methods.addLiquidity(initialPoolLiquidity).send({ from: l1LiquidityProvider });

      // Mint some tokens for the L2 depositor.
      await l2Token.methods.mint(l2Depositor, depositAmount.muln(10)).send({ from: l2Owner });
      await l2Token.methods
        .approve(bridgeDepositBox.options.address, depositAmount.muln(10))
        .send({ from: l2Depositor });
    });
    it("Correctly Fetches tokens bridged events from L2 Bridge Deposit Box", async function () {
      // Deposit some tokens and bridge them. Check the client picks it up accordingly.
      await l2Token.methods.mint(l1LiquidityProvider, toWei("200")).send({ from: l2Owner });
      await l2Token.methods.approve(bridgeDepositBox.options.address, toWei("200")).send({ from: l1LiquidityProvider });
      const depositTimestamp = Number(await l2Timer.methods.getCurrentTime().call());
      const quoteTimestamp = depositTimestamp;
      await bridgeDepositBox.methods
        .deposit(
          l1LiquidityProvider,
          l2Token.options.address,
          depositAmount,
          toWei("0.1"),
          toWei("0.1"),
          quoteTimestamp
        )
        .send({ from: l1LiquidityProvider });
      await l2Timer.methods
        .setCurrentTime(Number(await l2Timer.methods.getCurrentTime().call()) + 2000)
        .send({ from: l2Owner });
      const bridgeTx = await bridgeDepositBox.methods
        .bridgeTokens(l2Token.options.address, 0)
        .send({ from: l1LiquidityProvider });

      // Fetch the TokensBridged events from the L2 bridge deposit box.
      await crossDomainFinalizer.fetchTokensBridgedEvents();

      assert.equal(crossDomainFinalizer.getTokensBridgedTransactionsForL2Token(l2Token.options.address).length, 1);
      assert.equal(
        crossDomainFinalizer.getTokensBridgedTransactionsForL2Token(l2Token.options.address)[0],
        bridgeTx.transactionHash
      );
    });
    it("Correctly sends L1 cross domain finalization transactions on confirmed L2->L1 transfers", async function () {
      // The crossdomain finalizer was initiated using a bridge adapter mock to abstract away cross-chain implementation
      // details from this set of unit tests. Rather, we use a mock that lets us set transactions for each chain.
      // Initially, the transaction that will be returned for the cross-chain finalization is null (no actions yet).
      // In this case, we should see associated logs and no errors.
      await Promise.all([l1Client.update(), l2Client.update()]);
      await crossDomainFinalizer.checkForConfirmedL2ToL1RelaysAndFinalize();
      assert.isTrue(spyLogIncludes(spy, -2, "Checking for confirmed L2->L1 canonical bridge actions"));
      assert.isTrue(spyLogIncludes(spy, -2, `whitelistedL2Tokens":["${l2Token.options.address}"]`));
      assert.isTrue(spyLogIncludes(spy, -2, "Checking for confirmed L2->L1 canonical bridge actions"));
      assert.isTrue(spyLogIncludes(spy, -2, `l2TokensBridgedTransactions":[]`));
      assert.isTrue(spyLogIncludes(spy, -1, `No L2->L1 relays to finalize`));

      const depositTime = await bridgeDepositBox.methods.getCurrentTime().call();

      await bridgeDepositBox.methods
        .deposit(
          l2Depositor,
          l2Token.options.address,
          depositAmount.muln(4),
          defaultSlowRelayFeePct,
          defaultInstantRelayFeePct,
          depositTime
        )
        .send({ from: l2Depositor });

      // Now, advance time such that the L2->L1 token bridging action should be enabled.
      await l2Timer.methods.setCurrentTime(Number(depositTime) + minimumBridgingDelay + 1).send({ from: l1Owner });
      assert.isTrue(await bridgeDepositBox.methods.canBridge(l2Token.options.address).call());

      const bridgeTx = await bridgeDepositBox.methods
        .bridgeTokens(l2Token.options.address, "0")
        .send({ from: l1Owner });

      // Now, the logs should contain the associated l2TokensBridgedTransactions transaction hashes.
      await Promise.all([l1Client.update(), l2Client.update()]);
      await crossDomainFinalizer.checkForConfirmedL2ToL1RelaysAndFinalize();
      assert.isTrue(spyLogIncludes(spy, -2, "Checking for confirmed L2->L1 canonical bridge actions"));
      assert.isTrue(spyLogIncludes(spy, -2, `l2TokensBridgedTransactions":["${bridgeTx.transactionHash}"]`));
      assert.isTrue(spyLogIncludes(spy, -1, `No L2->L1 relays to finalize`));

      // Now, we will manually send the finalization transaction in the mock bridge adapter. Note that this can be
      // any kind ot transaction; we are not actually implementing the L2->L1 canonical bridging action and simply
      // need this method to return some kind of transaction that the CrossDomainFinalizer can run. For this test, we
      // will simply use an approval transaction.
      bridgeAdapterMock.setFinalizationTransaction(l2Token.methods.approve(l2Depositor, depositAmount));
      await crossDomainFinalizer.checkForConfirmedL2ToL1RelaysAndFinalize();
      assert.isTrue(spyLogIncludes(spy, -4, "Checking for confirmed L2->L1 canonical bridge actions"));
      assert.isTrue(spyLogIncludes(spy, -4, `l2TokensBridgedTransactions":["${bridgeTx.transactionHash}"]`));
      assert.isTrue(spyLogIncludes(spy, -3, "Found L2->L1 relays to finalize"));
      assert.isTrue(spyLogIncludes(spy, -3, `confirmedL2TransactionsToExecute":["${bridgeTx.transactionHash}"]`));
      assert.isTrue(spyLogIncludes(spy, -2, "Gas estimator updated"));
      assert.isTrue(spyLogIncludes(spy, -1, "Canonical L2->L1 transfer over the optimism bridge"));
      assert.isTrue(spyLogIncludes(spy, -1, "A total of 4.00 L2ERC20 was bridged")); // depositAmount.muln(4) is 4.
    });
  });
});
