import {
  SpyTransport,
  InsuredBridgeL1Client,
  InsuredBridgeL2Client,
  lastSpyLogIncludes,
  spyLogIncludes,
  GasEstimator,
  RateModel,
} from "@uma/financial-templates-lib";
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
let l1Token2: any;
let l2Token2: any;
let bridgePool2: any;

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
const rateModel: RateModel = { UBar: toBNWei("0.65"), R0: toBNWei("0.00"), R1: toBNWei("0.08"), R2: toBNWei("1.00") };
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
    l1Client = new InsuredBridgeL1Client(spyLogger, web3, bridgeAdmin.options.address, rateModels);
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
      crossDomainFinalizationThreshold
    );
  });
  describe("L2->L1 cross-domain transfers over the canonical bridge: single token", () => {
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
      assert.isTrue(lastSpyLogIncludes(spy, "L2ERC20 sent over optimism bridge"));
      assert.isFalse(await bridgeDepositBox.methods.canBridge(l2Token.options.address).call());
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
      assert.isTrue(spyLogIncludes(spy, -1, "L2ERC202 sent over optimism bridge"));
      assert.isTrue(spyLogIncludes(spy, -3, "L2ERC20 sent over optimism bridge"));
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
      assert.isTrue(spyLogIncludes(spy, -1, "L2ERC202 sent over optimism bridge"));
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
      assert.isTrue(spyLogIncludes(spy, -1, "L2ERC202 sent over optimism bridge"));
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
      console.log("bridgeTx", bridgeTx);

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
      assert.isTrue(spyLogIncludes(spy, -1, "A total of 4.00 L2ERC20 were bridged")); // depositAmount.muln(4) is 4.
    });
  });
});
