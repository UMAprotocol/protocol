import {
  SpyTransport,
  InsuredBridgeL1Client,
  InsuredBridgeL2Client,
  lastSpyLogIncludes,
  lastSpyLogLevel,
  GasEstimator,
  Deposit,
  ClientRelayState,
} from "@uma/financial-templates-lib";
import { across } from "@uma/sdk";

import winston from "winston";
import sinon from "sinon";
import hre from "hardhat";
const { assert } = require("chai");

import { interfaceName, TokenRolesEnum, HRE, ZERO_ADDRESS, createFormatFunction } from "@uma/common";
import { MockProfitabilityCalculator } from "./mocks/MockProfitabilityCalculator";
import { TokenType } from "../src/ProfitabilityCalculator";
import { MulticallBundler } from "../src/MulticallBundler";

// Tested file
import { Relayer, RelaySubmitType } from "../src/Relayer";

const { web3, getContract } = hre as HRE;
const { toWei, fromWei, toBN, utf8ToHex } = web3.utils;
const toBNWei = (number: string | number) => toBN(toWei(number.toString()).toString());

import type { BN } from "@uma/common";

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
const RateModelStore = getContract("RateModelStore");

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
let rateModelStore: any;

// Hard-coded test params:
const chainId = 10;
const whitelistedChainIds = [10, 12];
const defaultGasLimit = 1_000_000;
const defaultGasPrice = toWei("1", "gwei");
const defaultIdentifier = utf8ToHex("IS_CROSS_CHAIN_RELAY_VALID");
const defaultLiveness = 100;
const lpFeeRatePerSecond = toWei("0.0000015");
const finalFee = toWei("1");
const defaultProposerBondPct = toWei("0.05");
const defaultSlowRelayFeePct = toWei("0.05");
const defaultInstantRelayFeePct = toWei("0.05");
const defaultRealizedLpFeePct = toWei("0.05");
const minimumBridgingDelay = 60; // L2->L1 token bridging must wait at least this time.
const initialPoolLiquidity = toWei("100");
const depositAmount = toWei("1");
const rateModel: across.constants.RateModel = {
  UBar: toWei("0.65"),
  R0: toWei("0.00"),
  R1: toWei("0.08"),
  R2: toWei("1.00"),
};
const defaultLookbackWindow = 100;

describe("Relayer.ts", function () {
  let l1Accounts;
  let l1Owner: string;
  let l1Relayer: any;
  let l1LiquidityProvider: any;

  let l2Owner: any;
  let l2Depositor: any;
  let l2BridgeAdminImpersonator: any;

  let spyLogger: any;
  let spy: any;

  let relayer: any;
  let l1Client: any;
  let l2Client: any;
  let gasEstimator: any;
  let profitabilityCalculator: any;
  let multicallBundler: any;

  let l1DeployData: any;
  let l2DeployData: any;

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

    // Create the profitabilityCalculator. Set the discount rate to 100% so that the calculator does not consider the
    // cost of the l1 token. In doing so, we only test the relayer directly, ignoring profitability. The calculator will
    // return the relay type that produces the most revenue, irrespective of cost.
    profitabilityCalculator = new MockProfitabilityCalculator(spyLogger, [l1Token.options.address], 1, web3, 100);
    profitabilityCalculator.setL1TokenInfo({
      [l1Token.options.address]: { tokenType: TokenType.ERC20, tokenEthPrice: toBNWei("0.1"), decimals: toBN(18) },
    });

    multicallBundler = new MulticallBundler(spyLogger, gasEstimator, web3, l1Relayer);

    relayer = new Relayer(
      spyLogger,
      gasEstimator,
      l1Client,
      l2Client,
      profitabilityCalculator,
      [l1Token.options.address],
      l1Relayer,
      whitelistedChainIds,
      l1DeployData,
      l2DeployData,
      defaultLookbackWindow,
      multicallBundler
    );
  });
  it("Initialization is correct", async function () {
    assert.equal(relayer.l1Client.bridgeAdminAddress, bridgeAdmin.options.address);
    assert.equal(relayer.l2Client.bridgeDepositAddress, bridgeDepositBox.options.address);
  });
  describe("Should relay logic", () => {
    let deposit: Deposit;
    let clientRelayState: ClientRelayState;
    beforeEach(async function () {
      // Create a sample deposit with default data.
      deposit = {
        chainId: chainId,
        depositId: 0,
        depositHash: "0x123",
        l2Sender: l2Depositor,
        l1Recipient: l2Depositor,
        l1Token: l1Token.options.address,
        amount: depositAmount,
        slowRelayFeePct: defaultSlowRelayFeePct,
        instantRelayFeePct: defaultInstantRelayFeePct,
        quoteTimestamp: 1,
        depositContract: bridgeDepositBox.options.address,
      };

      // Set the relay ability to any. This represents a deposit that has not had any data brought to L1 yet.
      clientRelayState = ClientRelayState.Uninitialized;

      // Update the profitabilityCalculator so it has pricing information.
      await profitabilityCalculator.update();
    });
    it("Correctly decides when to do nothing", async function () {
      // There are two cases where the relayer should do nothing: a) it does not have enough token balance and b) when
      // the relay is already finalized. test each:

      // a) Dont add any tokens to the relayer. The relayer does not have enough to do any action and should do nothing.
      assert.equal(
        (await relayer.shouldRelay(deposit, clientRelayState, toBN(defaultRealizedLpFeePct), false)).relaySubmitType,
        RelaySubmitType.Ignore
      );

      // b) Mint tokens to the relayer BUT set the ClientRelayState to Finalized. This is the case once the Relay has
      // already been finalized by another relayer and there is nothing to do. Again, the return value should be Ignore.
      await l1Token.methods.mint(l1Relayer, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Relayer });
      clientRelayState = ClientRelayState.Finalized;
      assert.equal(
        (await relayer.shouldRelay(deposit, clientRelayState, toBN(defaultRealizedLpFeePct), false)).relaySubmitType,
        RelaySubmitType.Ignore
      );

      // c) Relay is pending and already spedup
      clientRelayState = ClientRelayState.Pending;
      assert.equal(
        (await relayer.shouldRelay(deposit, clientRelayState, toBN(defaultRealizedLpFeePct), true)).relaySubmitType,
        RelaySubmitType.Ignore
      );
    });
    it("Correctly decides when to slow relay", async function () {
      // The only time the relayer should decide to do a slow relay is when: a) the relayer has enough tokens, b) the
      // deposit has had no other relayer pick it up and c) the deposit contains an instantRelayFeePct set to 0.

      // Mint tokens, set ClientRelayState to Any and update instantRelayFeePct.
      await l1Token.methods.mint(l1Relayer, toBN(defaultProposerBondPct).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Relayer });
      clientRelayState = ClientRelayState.Uninitialized;
      deposit.instantRelayFeePct = "0";
      assert.equal(
        (await relayer.shouldRelay(deposit, clientRelayState, toBN(defaultRealizedLpFeePct), false)).relaySubmitType,
        RelaySubmitType.Slow
      );

      // Validate the negative cases.

      // a) The amount minted to the relayer is enough to cover the proposer bond but not the instant relay. Therefore
      // even if the relay is instantly profitable the relayer should choose to slow relay as it's all it can afford.
      deposit.instantRelayFeePct = toWei("0.05");
      assert.equal(
        (await relayer.shouldRelay(deposit, clientRelayState, toBN(defaultRealizedLpFeePct), false)).relaySubmitType,
        RelaySubmitType.Slow
      );

      // b) If the relayer is sent more tokens and instantRelayFeePct is anything greater than zero with the relay this
      // set to any then the relayer should not propose a slow relay.
      await l1Token.methods.mint(l1Relayer, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      assert.notEqual(
        (await relayer.shouldRelay(deposit, clientRelayState, toBN(defaultRealizedLpFeePct), false)).relaySubmitType,
        RelaySubmitType.Slow
      );
    });
    it("Correctly decides when to instant relay", async function () {
      // The relayer should instant relay when: a) the relay has not yet been brought onto L1 (uninitialized), b) the
      // profit from instant relaying is more than the profit from slow relaying(i.e instantRelayFeePct > 0) and c) the
      // bot has enough token balance to front both the slow relay token requirement AND instant token requirement and
      // c) the profit from instant relaying is more than the profit from slow relaying (i.e instantRelayFeePct>0).

      // Mint tokens and set ClientRelayState to any.
      await l1Token.methods.mint(l1Relayer, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Relayer });
      clientRelayState = ClientRelayState.Uninitialized;
      assert.equal(
        (await relayer.shouldRelay(deposit, clientRelayState, toBN(defaultRealizedLpFeePct), false)).relaySubmitType,
        RelaySubmitType.Instant
      );

      // Modifying any of the above 4 conditions should make the bot not instant relay.

      // a) There already exists an instant relayer for this relay.
      assert.notEqual(
        (await relayer.shouldRelay(deposit, clientRelayState, toBN(defaultRealizedLpFeePct), true)).relaySubmitType,
        RelaySubmitType.Instant
      );

      // b) ClientRelayState set to SpeedUpOnly
      clientRelayState = ClientRelayState.Pending;
      assert.notEqual(
        (await relayer.shouldRelay(deposit, clientRelayState, toBN(defaultRealizedLpFeePct), false)).relaySubmitType,
        RelaySubmitType.Instant
      );

      // c) ClientRelayState set to SpeedUpOnly back to Any and profit set to something that makes instant relay less profit
      clientRelayState = ClientRelayState.Uninitialized;
      deposit.instantRelayFeePct = "0";
      assert.notEqual(
        (await relayer.shouldRelay(deposit, clientRelayState, toBN(defaultRealizedLpFeePct), false)).relaySubmitType,
        RelaySubmitType.Instant
      );

      // d) reset the instantRelayFeePct and set the token balance of the relayer to something too little to instant
      deposit.instantRelayFeePct = defaultInstantRelayFeePct;
      await l1Token.methods.transfer(l1Owner, toBN(depositAmount).muln(1.5)).send({ from: l1Relayer });
      assert.notEqual(
        (await relayer.shouldRelay(deposit, clientRelayState, toBN(defaultRealizedLpFeePct), false)).relaySubmitType,
        RelaySubmitType.Instant
      );
    });
    it("Correctly decides when to speedup relay", async function () {
      // The relayer should only speed up if the relay is: a) already relayed by another relayer (in SpeedUpOnly) state
      // and b) the relayer has enough balance. Under all other conditions it should not do this action.

      await l1Token.methods.mint(l1Relayer, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Relayer });
      clientRelayState = ClientRelayState.Pending;
      assert.equal(
        (await relayer.shouldRelay(deposit, clientRelayState, toBN(defaultRealizedLpFeePct), false)).relaySubmitType,
        RelaySubmitType.SpeedUp
      );

      // Modify above conditions:

      // a) not in SpeedUpOnly State
      clientRelayState = ClientRelayState.Uninitialized;
      assert.notEqual(
        (await relayer.shouldRelay(deposit, clientRelayState, toBN(defaultRealizedLpFeePct), false)).relaySubmitType,
        RelaySubmitType.SpeedUp
      );

      // b) reset in  ClientRelayState and bot does not have enough balance.
      clientRelayState = ClientRelayState.Pending;
      await l1Token.methods.transfer(l1Owner, toBN(depositAmount).muln(1.5)).send({ from: l1Relayer });
      assert.notEqual(
        (await relayer.shouldRelay(deposit, clientRelayState, toBN(defaultRealizedLpFeePct), false)).relaySubmitType,
        RelaySubmitType.SpeedUp
      );
    });
  });
  describe("Relay transaction execution functionality", () => {
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
    it("Can correctly detect and produce slow relays", async function () {
      // Before any relays should do nothing and log accordingly.
      await Promise.all([l1Client.update(), l2Client.update()]);
      await relayer.checkForPendingDepositsAndRelay();
      assert.isTrue(lastSpyLogIncludes(spy, "No relayable deposits"));

      // Make a deposit on L2 and check the bot relays it accordingly.
      await l2Token.methods.approve(bridgeDepositBox.options.address, depositAmount).send({ from: l2Depositor });
      const relayTime = await bridgePool.methods.getCurrentTime().call();
      const quoteTime = (await web3.eth.getBlock("latest")).timestamp;
      const depositData = {
        chainId,
        depositId: "0",
        l1Recipient: l2Depositor,
        l2Sender: l2Depositor,
        amount: depositAmount,
        slowRelayFeePct: defaultSlowRelayFeePct,
        instantRelayFeePct: "0", // set to zero to force slow relay for this test.
        quoteTimestamp: quoteTime,
      };
      await bridgeDepositBox.methods
        .deposit(
          depositData.l1Recipient,
          l2Token.options.address,
          depositData.amount,
          depositData.slowRelayFeePct,
          depositData.instantRelayFeePct, // set to zero to force slow relay for this test.
          depositData.quoteTimestamp
        )
        .send({ from: l2Depositor });
      await Promise.all([l1Client.update(), l2Client.update()]);
      // As the relayer does not have enough token balance to do the relay (0 minted) should do nothing.
      await relayer.checkForPendingDepositsAndRelay();
      assert.isTrue(lastSpyLogIncludes(spy, "Not relaying"));

      // Mint the relayer some tokens and try again.
      await l1Token.methods.mint(l1Relayer, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Relayer });
      await relayer.checkForPendingDepositsAndRelay();
      assert.isTrue(lastSpyLogIncludes(spy, "Slow relaying deposit"));

      // Send transactions.
      await multicallBundler?.send();
      assert.isTrue(lastSpyLogIncludes(spy, "Slow Relay executed"));
      await multicallBundler?.waitForMine();

      // Advance time such that relay has expired and check that bot correctly identifies it as expired.
      const expirationTime = Number(relayTime.toString()) + defaultLiveness;
      await bridgePool.methods.setCurrentTime(expirationTime).send({ from: l1Owner });
      await l1Client.update();
      await relayer.checkForPendingDepositsAndRelay();
      assert.isTrue(lastSpyLogIncludes(spy, "Pending relay has expired"));

      // Settle relay and check that bot detects it as finalized.
      const relay = (await bridgePool.getPastEvents("DepositRelayed", { fromBlock: 0 }))[0];
      await bridgePool.methods.settleRelay(depositData, relay.returnValues.relay).send({ from: l1Relayer });
      await l1Client.update();
      await relayer.checkForPendingDepositsAndRelay();
      // Bot filters out Finalized relays
      assert.isTrue(lastSpyLogIncludes(spy, "No relayable deposits"));
    });
    it("Two deposits, one relay fails, one succeeds", async function () {
      // Validates that one failed tx does not break the other in multi execution. Also validates unbundling with
      // error works as expected.

      // Deposit #1
      await l2Token.methods.approve(bridgeDepositBox.options.address, depositAmount).send({ from: l2Depositor });
      const quoteTime = (await web3.eth.getBlock("latest")).timestamp;
      const depositData = {
        chainId,
        depositId: "0",
        l1Recipient: l2Depositor,
        l2Sender: l2Depositor,
        amount: depositAmount,
        slowRelayFeePct: defaultSlowRelayFeePct,
        instantRelayFeePct: "0", // set to zero to force slow relay for this test.
        quoteTimestamp: quoteTime,
      };
      await bridgeDepositBox.methods
        .deposit(
          depositData.l1Recipient,
          l2Token.options.address,
          depositData.amount,
          depositData.slowRelayFeePct,
          depositData.instantRelayFeePct, // set to zero to force slow relay for this test.
          depositData.quoteTimestamp
        )
        .send({ from: l2Depositor });

      // Deposit #2
      await l2Token.methods.mint(l2Depositor, depositAmount).send({ from: l2Owner });
      await l2Token.methods.approve(bridgeDepositBox.options.address, depositAmount).send({ from: l2Depositor });
      await bridgeDepositBox.methods
        .deposit(
          depositData.l1Recipient,
          l2Token.options.address,
          depositData.amount,
          depositData.slowRelayFeePct,
          depositData.instantRelayFeePct, // set to zero to force slow relay for this test.
          depositData.quoteTimestamp
        )
        .send({ from: l2Depositor });
      await Promise.all([l1Client.update(), l2Client.update()]);

      // Mint the relayer enough tokens for two slow relays, but only approve enough for one. This should cause the
      // second relay to error:
      await l1Token.methods.mint(l1Relayer, toBN(depositAmount).muln(4)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Relayer });
      await relayer.checkForPendingDepositsAndRelay();
      await multicallBundler?.send();

      // Should send out a single log informing the user that the batch is being split up.
      assert.equal(
        spy.getCalls().filter((_log: any) => _log.lastArg.message.includes("Sending batched transactions individually"))
          .length,
        1
      );

      // Logs should reflect one slow relay executed and one that errored.
      assert.equal(
        spy.getCalls().filter((_log: any) => _log.lastArg.message.includes("Slow Relay executed")).length,
        1
      );

      // The final log should be an error from the failed second transaction in the bundle.
      assert.isTrue(lastSpyLogIncludes(spy, "Errors sending transactions individually"));

      // Ensure transactions got mined.
      await multicallBundler?.waitForMine();
    });
    it("Can correctly detect and produce speedup relays", async function () {
      // Make a deposit on L2 and relay it. Then, check the relayer picks this up and speeds up the relay.
      await l2Token.methods.approve(bridgeDepositBox.options.address, depositAmount).send({ from: l2Depositor });
      const currentBlockTime = (await web3.eth.getBlock("latest")).timestamp;
      await bridgeDepositBox.methods
        .deposit(
          l2Depositor,
          l2Token.options.address,
          depositAmount,
          defaultSlowRelayFeePct,
          defaultInstantRelayFeePct,
          currentBlockTime
        )
        .send({ from: l2Depositor });

      // Relay it from the tests to mimic someone else doing the slow relay.
      await l1Token.methods.mint(l1Owner, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await bridgePool.methods
        .relayDeposit(
          {
            chainId: chainId,
            depositId: "0",
            l2Sender: l2Depositor,
            l1Recipient: l2Depositor,
            amount: depositAmount,
            slowRelayFeePct: defaultSlowRelayFeePct,
            instantRelayFeePct: defaultInstantRelayFeePct,
            quoteTimestamp: currentBlockTime,
          },
          across.feeCalculator.calculateRealizedLpFeePct(rateModel, toWei("0"), toWei("0.01")) // compute the expected fee for 1% utilization
        )
        .send({ from: l1Owner });

      // Now, run the relayer. the bot should detect that a relay has been created but not yet sped up. It should
      // correctly detect this and submit the relay speed up transaction.
      await Promise.all([l1Client.update(), l2Client.update()]);
      // As the relayer does not have enough token balance to do the relay (0 minted) should do nothing .
      await relayer.checkForPendingDepositsAndRelay();
      assert.isTrue(lastSpyLogIncludes(spy, "Not relaying"));

      // Mint the relayer some tokens and try again.
      await l1Token.methods.mint(l1Relayer, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Relayer });
      await relayer.checkForPendingDepositsAndRelay();
      await multicallBundler?.send();
      await multicallBundler?.waitForMine();
      assert.isTrue(lastSpyLogIncludes(spy, "Slow relay sped up"));

      // Running relayer again ignores and sends appropriate message
      await Promise.all([l1Client.update(), l2Client.update()]);
      await relayer.checkForPendingDepositsAndRelay();
      assert.isTrue(lastSpyLogIncludes(spy, "already sped up"));
    });
    it("Can correctly instantly relay deposits", async function () {
      // Make a deposit on L2 and see that the relayer correctly sends a slow relay and speedup it in the same tx.
      await l2Token.methods.approve(bridgeDepositBox.options.address, depositAmount).send({ from: l2Depositor });
      const currentBlockTime = (await web3.eth.getBlock("latest")).timestamp;
      await bridgeDepositBox.methods
        .deposit(
          l2Depositor,
          l2Token.options.address,
          depositAmount,
          defaultSlowRelayFeePct,
          defaultInstantRelayFeePct,
          currentBlockTime
        )
        .send({ from: l2Depositor });

      // Now, run the relayer. the bot should detect that a relay has been created but not yet sped up. It should
      // correctly detect this and submit the relay speed up transaction.
      await Promise.all([l1Client.update(), l2Client.update()]);
      // As the relayer does not have enough token balance to do the relay (0 minted) should do nothing.
      await relayer.checkForPendingDepositsAndRelay();
      assert.isTrue(lastSpyLogIncludes(spy, "Not relaying"));

      // Mint the relayer some tokens and try again.
      await l1Token.methods.mint(l1Relayer, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Relayer });
      await relayer.checkForPendingDepositsAndRelay();
      await multicallBundler?.send();
      await multicallBundler?.waitForMine();
      assert.isTrue(lastSpyLogIncludes(spy, "Relay instantly sent"));
    });
    it("Does not speedup relays with invalid relay data", async function () {
      // Make a deposit on L2 and relay it with invalid relay params. The relayer should detect that the relay params
      // are invalid and skip it.
      await l2Token.methods.approve(bridgeDepositBox.options.address, depositAmount).send({ from: l2Depositor });
      const relayTime = await bridgePool.methods.getCurrentTime().call();
      const quoteTime = (await web3.eth.getBlock("latest")).timestamp;
      await bridgeDepositBox.methods
        .deposit(
          l2Depositor,
          l2Token.options.address,
          depositAmount,
          defaultSlowRelayFeePct,
          defaultInstantRelayFeePct,
          quoteTime
        )
        .send({ from: l2Depositor });

      // Relay it from the tests to mimic someone else doing the slow relay.
      await l1Token.methods.mint(l1Owner, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await bridgePool.methods
        .relayDeposit(
          {
            chainId: chainId,
            depositId: "0",
            l2Sender: l2Depositor,
            l1Recipient: l2Depositor,
            amount: depositAmount,
            slowRelayFeePct: defaultSlowRelayFeePct,
            instantRelayFeePct: defaultInstantRelayFeePct,
            quoteTimestamp: quoteTime,
          },
          toBN(defaultRealizedLpFeePct)
            .mul(toBN(toWei("2")))
            .div(toBN(toWei("1")))
            .toString() // Invalid relay param
        )
        .send({ from: l1Owner });

      // Now, run the relayer and check that it ignores the relay.
      await Promise.all([l1Client.update(), l2Client.update()]);
      await l1Token.methods.mint(l1Relayer, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Relayer });
      await relayer.checkForPendingDepositsAndRelay();
      assert.isTrue(lastSpyLogIncludes(spy, "Pending relay is invalid"));

      // Advance time such that relay has expired and check that bot correctly identifies it as expired. Even if the
      // relay params are invalid, post-expiry its not disputable.
      const expirationTime = Number(relayTime.toString()) + defaultLiveness;
      await bridgePool.methods.setCurrentTime(expirationTime).send({ from: l1Owner });
      await Promise.all([l1Client.update()]);
      await relayer.checkForPendingDepositsAndRelay();
      assert.isTrue(lastSpyLogIncludes(spy, "Pending relay has expired"));
    });
    it("Skips deposits with quote time < contract deployment time", async function () {
      // Deposit using quote time prior to deploy timestamp for this L1 token.
      const quoteTime = Number(l1DeployData[l1Token.options.address].timestamp) - 1;
      await l2Token.methods.approve(bridgeDepositBox.options.address, depositAmount).send({ from: l2Depositor });
      await bridgeDepositBox.methods
        .deposit(
          l2Depositor,
          l2Token.options.address,
          depositAmount,
          defaultSlowRelayFeePct,
          defaultInstantRelayFeePct,
          quoteTime.toString()
        )
        .send({ from: l2Depositor });
      // Now, run the relayer and check that it ignores the relay.
      await Promise.all([l1Client.update(), l2Client.update()]);
      await l1Token.methods.mint(l1Relayer, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Relayer });
      await relayer.checkForPendingDepositsAndRelay();
      assert.isTrue(lastSpyLogIncludes(spy, "Deposit quote time < bridge pool deployment"));

      // Relay the deposit from another slow relayer, and check that the bot skips any attempt to speed up the relay
      // since it cannot verify its realized LP fee %.
      await l1Token.methods.mint(l1Owner, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await bridgePool.methods
        .relayDeposit(
          {
            chainId: chainId,
            depositId: "0",
            l2Sender: l2Depositor,
            l1Recipient: l2Depositor,
            amount: depositAmount,
            slowRelayFeePct: defaultSlowRelayFeePct,
            instantRelayFeePct: defaultInstantRelayFeePct,
            quoteTimestamp: quoteTime,
          },
          across.feeCalculator.calculateRealizedLpFeePct(rateModel, toWei("0"), toWei("0.01")) // compute the expected fee for 1% utilization
        )
        .send({ from: l1Owner });
      await Promise.all([l1Client.update(), l2Client.update()]);
      await relayer.checkForPendingDepositsAndRelay();
      assert.isTrue(lastSpyLogIncludes(spy, "Deposit quote time < bridge pool deployment"));
    });
    it("Skips deposits with quote time > contract deployment time", async function () {
      // Deposit using quote time after current block time.
      const quoteTime = Number((await web3.eth.getBlock("latest")).timestamp) + 60;
      await l2Token.methods.approve(bridgeDepositBox.options.address, depositAmount).send({ from: l2Depositor });
      await bridgeDepositBox.methods
        .deposit(
          l2Depositor,
          l2Token.options.address,
          depositAmount,
          defaultSlowRelayFeePct,
          defaultInstantRelayFeePct,
          quoteTime.toString()
        )
        .send({ from: l2Depositor });
      // Now, run the relayer and check that it ignores the relay.
      await Promise.all([l1Client.update(), l2Client.update()]);
      await l1Token.methods.mint(l1Relayer, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Relayer });
      await relayer.checkForPendingDepositsAndRelay();
      assert.isTrue(lastSpyLogIncludes(spy, "> latest block time"));

      // Relay the deposit from another slow relayer, and check that the bot skips any attempt to speed up the relay
      // since it cannot verify its realized LP fee %.
      await l1Token.methods.mint(l1Owner, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await bridgePool.methods
        .relayDeposit(
          {
            chainId: chainId,
            depositId: "0",
            l2Sender: l2Depositor,
            l1Recipient: l2Depositor,
            amount: depositAmount,
            slowRelayFeePct: defaultSlowRelayFeePct,
            instantRelayFeePct: defaultInstantRelayFeePct,
            quoteTimestamp: quoteTime,
          },
          across.feeCalculator.calculateRealizedLpFeePct(rateModel, toWei("0"), toWei("0.01")) // compute the expected fee for 1% utilization
        )
        .send({ from: l1Owner });
      await Promise.all([l1Client.update(), l2Client.update()]);
      await relayer.checkForPendingDepositsAndRelay();
      assert.isTrue(lastSpyLogIncludes(spy, "> latest block time"));
    });
    it("Correctly produces logs when deciding to not relay due to low profitability", async function () {
      // Validate the logs produced when deciding to not relay due to low profitability. The relayer is initialized with
      // a gas estimator that is never updated. For l1 the estimator defaults to 500 Gwei as the maxFeePerGas and 5 as
      // the max priority fee. If not updated, the latest base fee per gas is set to the maxFeePerGas. Therefore this
      // test will use a expected cumulative gas price of 505 gwei. Also, create a new profitability calculator with
      //  discount set to 0. Seed the L1 token price at 1 in ETH (consider this to be eth for this test).
      profitabilityCalculator = new MockProfitabilityCalculator(spyLogger, [l1Token.options.address], 1, web3, 0);
      profitabilityCalculator.setL1TokenInfo({
        [l1Token.options.address]: { tokenType: TokenType.WETH, tokenEthPrice: toBNWei("1"), decimals: toBN(18) },
      });

      relayer = new Relayer(
        spyLogger,
        gasEstimator,
        l1Client,
        l2Client,
        profitabilityCalculator,
        [l1Token.options.address],
        l1Relayer,
        whitelistedChainIds,
        l1DeployData,
        l2DeployData,
        defaultLookbackWindow,
        multicallBundler
      );

      await l2Token.methods.approve(bridgeDepositBox.options.address, depositAmount).send({ from: l2Depositor });
      const quoteTime = (await web3.eth.getBlock("latest")).timestamp;
      // Set the slow relay reward to 5% and instant reward to 1%. With a relay size of 1 ETH and the default fee per gas
      // of 505 gwei, this is unprofitable given the current cost of each relay action.
      const depositData = {
        chainId,
        depositId: "0",
        l1Recipient: l2Depositor,
        l2Sender: l2Depositor,
        amount: depositAmount,
        slowRelayFeePct: toWei("0.05"),
        instantRelayFeePct: toWei("0.01"),
        quoteTimestamp: quoteTime,
      };
      await bridgeDepositBox.methods
        .deposit(
          depositData.l1Recipient,
          l2Token.options.address,
          depositData.amount,
          depositData.slowRelayFeePct,
          depositData.instantRelayFeePct, // set to zero to force slow relay for this test.
          depositData.quoteTimestamp
        )
        .send({ from: l2Depositor });
      // Mint tokens to the relayer
      await l1Token.methods.mint(l1Relayer, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Relayer });
      await Promise.all([l1Client.update(), l2Client.update()]);

      await relayer.checkForPendingDepositsAndRelay();

      // Check the output of the last log.
      assert.isTrue(lastSpyLogIncludes(spy, "Not relaying unprofitable deposit")); // not relaying log
      assert.isTrue(lastSpyLogIncludes(spy, "Deposit depositId 0 on optimism of 1.00 TESTERC20 sent from")); // associated meta data
      // check profitability logs:
      const slowReward = toBNWei(0.05);
      const fastReward = toBNWei(0.01);
      const cumulativeGasPrice = toBN(505e9);
      const formatWei = createFormatFunction(2, 4, false, 18);
      const slowProfit = formatWei(slowReward.sub(cumulativeGasPrice.mul(toBN(across.constants.SLOW_ETH_GAS))));
      const fastProfit = formatWei(
        slowReward.add(fastReward).sub(cumulativeGasPrice.mul(toBN(across.constants.FAST_ETH_GAS)))
      );
      const speedUpProfit = formatWei(fastReward.sub(cumulativeGasPrice.mul(toBN(across.constants.SPEED_UP_ETH_GAS))));
      assert.isTrue(lastSpyLogIncludes(spy, `SlowRelay profit ${slowProfit}`));
      assert.isTrue(lastSpyLogIncludes(spy, `InstantRelay profit ${fastProfit}`));
      assert.isTrue(lastSpyLogIncludes(spy, `SpeedUpRelay profit ${speedUpProfit}`));

      // Finally, check the log contains the correct break even data.
      const formatGwei = (number: string | number | BN) => Math.ceil(Number(fromWei(number.toString(), "gwei")));
      const breakEvenSlowGasPrice = formatGwei(slowReward.div(toBN(across.constants.SLOW_ETH_GAS)));
      const breakEvenFastGasPrice = formatGwei(slowReward.add(fastReward).div(toBN(across.constants.FAST_ETH_GAS)));
      const breakEvenSpeedUpGasPrice = formatGwei(fastReward.div(toBN(across.constants.SPEED_UP_ETH_GAS)));

      assert.isTrue(lastSpyLogIncludes(spy, `SlowRelay ${breakEvenSlowGasPrice} Gwei`));
      assert.isTrue(lastSpyLogIncludes(spy, `InstantRelay ${breakEvenFastGasPrice} Gwei`));
      assert.isTrue(lastSpyLogIncludes(spy, `SpeedUpRelay ${breakEvenSpeedUpGasPrice} Gwei`));
    });
  });
  describe("Settle Relay transaction functionality", () => {
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
    it("Can correctly detect and settleable relays and settle them", async function () {
      // Before any relays should do nothing and log accordingly.
      await Promise.all([l1Client.update(), l2Client.update()]);
      await relayer.checkforSettleableRelaysAndSettle();
      assert.isTrue(lastSpyLogIncludes(spy, "No settleable relays"));

      // Make a deposit on L2, relay it, advance time and check the bot settles it accordingly.
      await l2Token.methods.approve(bridgeDepositBox.options.address, depositAmount).send({ from: l2Depositor });
      const currentBlockTime = (await web3.eth.getBlock("latest")).timestamp;
      await bridgeDepositBox.methods
        .deposit(
          l2Depositor,
          l2Token.options.address,
          depositAmount,
          defaultSlowRelayFeePct,
          "0", // set to zero to force slow relay for this test.
          currentBlockTime
        )
        .send({ from: l2Depositor });

      // Mint the relayer some tokens and try again.
      await l1Token.methods.mint(l1Relayer, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Relayer });
      await Promise.all([l1Client.update(), l2Client.update()]);
      await relayer.checkForPendingDepositsAndRelay();
      await multicallBundler?.send();
      await multicallBundler?.waitForMine();
      assert.isTrue(lastSpyLogIncludes(spy, "Slow Relay executed"));

      // Advance time to get the relay into a settable state.
      await l1Timer.methods
        .setCurrentTime(Number((await l1Timer.methods.getCurrentTime().call()) + defaultLiveness + 1))
        .send({ from: l1Owner });

      await Promise.all([l1Client.update(), l2Client.update()]);
      await relayer.checkforSettleableRelaysAndSettle();
      await multicallBundler?.send();
      await multicallBundler?.waitForMine();
      assert.isTrue(lastSpyLogIncludes(spy, "Relay settled"));
    });
    it("Can correctly detect and settleable relays from other relayers and settle them", async function () {
      // Make a deposit on L2, relay it, advance time and check the bot settles it accordingly.
      await l2Token.methods.approve(bridgeDepositBox.options.address, depositAmount).send({ from: l2Depositor });

      // Sync block times. This is only needed in this test because we are manually depositing and relaying.
      const currentBlockTime = Number((await web3.eth.getBlock(await web3.eth.getBlockNumber())).timestamp);

      await l1Timer.methods.setCurrentTime(currentBlockTime).send({ from: l1Owner });
      await l2Timer.methods.setCurrentTime(currentBlockTime).send({ from: l1Owner });
      await bridgeDepositBox.methods
        .deposit(
          l2Depositor,
          l2Token.options.address,
          depositAmount,
          defaultSlowRelayFeePct,
          "0", // set to zero to force slow relay for this test.
          currentBlockTime
        )
        .send({ from: l2Depositor });

      // Relay from an account other than the relayer.
      await l1Token.methods.mint(l1Owner, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Client.update(); // update L1 client to enable LP fee computation
      await bridgePool.methods
        .relayDeposit(
          {
            chainId: chainId,
            depositId: "0",
            l2Sender: l2Depositor,
            l1Recipient: l2Depositor,
            amount: depositAmount,
            slowRelayFeePct: defaultSlowRelayFeePct,
            instantRelayFeePct: "0", // set instant relay fee same as in the deposit call,
            quoteTimestamp: currentBlockTime,
          },
          await l1Client.calculateRealizedLpFeePctForDeposit({
            amount: depositAmount,
            l1Token: l1Token.options.address,
            quoteTimestamp: currentBlockTime,
          })
        )
        .send({ from: l1Owner });

      // Before any time advancement should be nothing settleable.
      await Promise.all([l1Client.update(), l2Client.update()]);
      await relayer.checkforSettleableRelaysAndSettle();
      assert.isTrue(lastSpyLogIncludes(spy, "No settleable relays"));

      // Advance time past liveness. This makes the relay settleable. However, as the relayer did not do the relay they can settle it.

      await l1Timer.methods
        .setCurrentTime(Number(await l1Timer.methods.getCurrentTime().call()) + defaultLiveness + 1)
        .send({ from: l1Owner });

      await Promise.all([l1Client.update(), l2Client.update()]);
      await relayer.checkforSettleableRelaysAndSettle();
      assert.isTrue(lastSpyLogIncludes(spy, "No settleable relays"));

      // If we now advance time 15 mins past the expiration, anyone can claim the relay. The relayer should now claim it.
      await l1Timer.methods
        .setCurrentTime(Number((await l1Timer.methods.getCurrentTime().call()) + 60 * 60 * 15 + 1))
        .send({ from: l1Owner });

      await Promise.all([l1Client.update(), l2Client.update()]);
      await relayer.checkforSettleableRelaysAndSettle();
      await multicallBundler?.send();
      await multicallBundler?.waitForMine();
      assert.isTrue(lastSpyLogIncludes(spy, "Relay settled"));
    });
  });
  describe("Dispute transaction functionality", function () {
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
    it("Disputes pending relays with invalid relay data", async function () {
      // This test looks exactly like the "Does not speedup relays with invalid relay data" test but it employs the
      // disputer mode (with the Disputer mode enabled) instead of the relayer bot.

      // Make a deposit on L2 and relay it with invalid relay params. The disputer should detect that the relay params
      // are invalid and dispute it.
      await l2Token.methods.approve(bridgeDepositBox.options.address, depositAmount).send({ from: l2Depositor });
      const quoteTime = (await web3.eth.getBlock("latest")).timestamp;
      await bridgeDepositBox.methods
        .deposit(
          l2Depositor,
          l2Token.options.address,
          depositAmount,
          defaultSlowRelayFeePct,
          defaultInstantRelayFeePct,
          quoteTime
        )
        .send({ from: l2Depositor });

      // Relay it from the tests to mimic someone else doing the slow relay.
      await l1Token.methods.mint(l1Owner, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await bridgePool.methods
        .relayDeposit(
          {
            chainId: chainId,
            depositId: "0",
            l2Sender: l2Depositor,
            l1Recipient: l2Depositor,
            amount: depositAmount,
            slowRelayFeePct: defaultSlowRelayFeePct,
            instantRelayFeePct: defaultInstantRelayFeePct,
            quoteTimestamp: quoteTime,
          },
          toBN(defaultRealizedLpFeePct)
            .mul(toBN(toWei("2")))
            .div(toBN(toWei("1")))
            .toString() // Invalid relay param
        )
        .send({ from: l1Owner });

      // Now, run the disputer and check that it disputes the relay.
      await Promise.all([l1Client.update(), l2Client.update()]);
      await l1Token.methods.mint(l1Relayer, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Relayer });
      await relayer.checkForPendingRelaysAndDispute();
      await multicallBundler?.send();
      await multicallBundler?.waitForMine();
      assert.isTrue(lastSpyLogIncludes(spy, "Disputed pending relay"));
      const disputeEvents = await bridgePool.getPastEvents("RelayDisputed", { fromBlock: 0 });
      assert.equal(disputeEvents.length, 1);
      assert.equal(lastSpyLogLevel(spy), "error");
    });
    it("Two pending relays with invalid relay data, one dispute succeeds, one fails", async function () {
      // Invalid relay #1
      await l1Token.methods.mint(l1Owner, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      const quoteTime = (await web3.eth.getBlock("latest")).timestamp;
      await bridgePool.methods
        .relayDeposit(
          {
            chainId: chainId,
            // Same chain ID as L2 client, meaning that if deposit can't be found the relay is disputable
            depositId: "99", // deposit ID doesn't exist
            l2Sender: l2Depositor,
            l1Recipient: l2Depositor,
            amount: depositAmount,
            slowRelayFeePct: defaultSlowRelayFeePct,
            instantRelayFeePct: defaultInstantRelayFeePct,
            quoteTimestamp: quoteTime,
          },
          toBN(defaultRealizedLpFeePct)
            .mul(toBN(toWei("2")))
            .div(toBN(toWei("1")))
            .toString() // Invalid relay param
        )
        .send({ from: l1Owner });

      // Invalid relay #2
      await l1Token.methods.mint(l1Owner, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await bridgePool.methods
        .relayDeposit(
          {
            chainId: chainId,
            // Same chain ID as L2 client, meaning that if deposit can't be found the relay is disputable
            depositId: "100", // deposit ID doesn't exist
            l2Sender: l2Depositor,
            l1Recipient: l2Depositor,
            amount: depositAmount,
            slowRelayFeePct: defaultSlowRelayFeePct,
            instantRelayFeePct: defaultInstantRelayFeePct,
            quoteTimestamp: quoteTime,
          },
          toBN(defaultRealizedLpFeePct)
            .mul(toBN(toWei("2")))
            .div(toBN(toWei("1")))
            .toString() // Invalid relay param
        )
        .send({ from: l1Owner });

      // Mint the disputer enough tokens for two disputes, but only approve enough for one. This should cause the
      // second dispute to error:
      await l1Token.methods.mint(l1Relayer, toBN(depositAmount).muln(4)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Relayer });
      await Promise.all([l1Client.update(), l2Client.update()]);
      await relayer.checkForPendingRelaysAndDispute();
      await multicallBundler?.send();
      await multicallBundler?.waitForMine();

      // Logs should reflect one dispute executed and one that errored.
      assert.equal(
        spy.getCalls().filter((_log: any) => _log.lastArg.message.includes("Disputed pending relay")).length,
        1
      );
      const disputeEvents = await bridgePool.getPastEvents("RelayDisputed", { fromBlock: 0 });
      assert.equal(disputeEvents.length, 1);
    });
    it("Dispute fails to send to OptimisticOracle", async function () {
      // Make a deposit on L2 and relay it with invalid relay params. The disputer should detect that the relay params
      // are invalid and dispute it.
      await l2Token.methods.approve(bridgeDepositBox.options.address, depositAmount).send({ from: l2Depositor });
      const quoteTime = (await web3.eth.getBlock("latest")).timestamp;
      await bridgeDepositBox.methods
        .deposit(
          l2Depositor,
          l2Token.options.address,
          depositAmount,
          defaultSlowRelayFeePct,
          defaultInstantRelayFeePct,
          quoteTime
        )
        .send({ from: l2Depositor });

      // Relay it from the tests to mimic someone else doing the slow relay.
      await l1Token.methods.mint(l1Owner, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await bridgePool.methods
        .relayDeposit(
          {
            chainId: chainId,
            depositId: "0",
            l2Sender: l2Depositor,
            l1Recipient: l2Depositor,
            amount: depositAmount,
            slowRelayFeePct: defaultSlowRelayFeePct,
            instantRelayFeePct: defaultInstantRelayFeePct,
            quoteTimestamp: quoteTime,
          },
          toBN(defaultRealizedLpFeePct)
            .mul(toBN(toWei("2")))
            .div(toBN(toWei("1")))
            .toString() // Invalid relay param
        )
        .send({ from: l1Owner });

      // Before disputing, remove identifier from whitelist to make price request to optimistic oracle revert.
      await identifierWhitelist.methods.removeSupportedIdentifier(defaultIdentifier).send({ from: l1Owner });

      // Now, run the disputer and check that it disputes the relay.
      await Promise.all([l1Client.update(), l2Client.update()]);
      await l1Token.methods.mint(l1Relayer, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Relayer });
      await relayer.checkForPendingRelaysAndDispute();
      await multicallBundler?.send();
      await multicallBundler?.waitForMine();
      assert.isTrue(lastSpyLogIncludes(spy, "Disputed pending relay"));

      // Add back identifier to restore state for other tests.
      await identifierWhitelist.methods.addSupportedIdentifier(defaultIdentifier).send({ from: l1Owner });
    });
    it("Disputes pending relays for deposits it cannot identify with same chain ID as l2 client", async function () {
      // Relay a deposit that doesn't exist on-chain
      await l1Token.methods.mint(l1Owner, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      const quoteTime = (await web3.eth.getBlock("latest")).timestamp;
      await bridgePool.methods
        .relayDeposit(
          {
            chainId: chainId,
            // Same chain ID as L2 client, meaning that if deposit can't be found the relay is disputable
            depositId: "99", // deposit ID doesn't exist
            l2Sender: l2Depositor,
            l1Recipient: l2Depositor,
            amount: depositAmount,
            slowRelayFeePct: defaultSlowRelayFeePct,
            instantRelayFeePct: defaultInstantRelayFeePct,
            quoteTimestamp: quoteTime,
          },
          toBN(defaultRealizedLpFeePct)
            .mul(toBN(toWei("2")))
            .div(toBN(toWei("1")))
            .toString() // Invalid relay param
        )
        .send({ from: l1Owner });

      // Now, run the disputer and check that it disputes the relay.
      await Promise.all([l1Client.update(), l2Client.update()]);
      await l1Token.methods.mint(l1Relayer, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Relayer });
      await relayer.checkForPendingRelaysAndDispute();
      await multicallBundler?.send();
      await multicallBundler?.waitForMine();
      assert.isTrue(lastSpyLogIncludes(spy, "Disputed pending relay"));
      const disputeEvents = await bridgePool.getPastEvents("RelayDisputed", { fromBlock: 0 });
      assert.equal(disputeEvents.length, 1);

      // L1 Client should no longer see relay.
      await Promise.all([l1Client.update(), l2Client.update()]);
      await relayer.checkForPendingRelaysAndDispute();
      assert.isTrue(lastSpyLogIncludes(spy, "No pending relays"));
    });
    it("Before disputing relays for deposits it cannot find, first tries to find deposit in new blocksearch", async function () {
      await l2Token.methods.approve(bridgeDepositBox.options.address, depositAmount).send({ from: l2Depositor });
      const quoteTime = Number((await web3.eth.getBlock("latest")).timestamp);
      await bridgeDepositBox.methods
        .deposit(
          l2Depositor,
          l2Token.options.address,
          depositAmount,
          defaultSlowRelayFeePct,
          defaultInstantRelayFeePct,
          quoteTime
        )
        .send({ from: l2Depositor });

      // Next, create a new L2 client that trivially sets its block range such that it can't find the deposit.
      l2Client = new InsuredBridgeL2Client(
        spyLogger,
        web3,
        bridgeDepositBox.options.address,
        chainId,
        0,
        1 // End block of 1, which is less than the deposit.
      );

      // Create new relayer and update it. It should not see any pending deposits.
      relayer = new Relayer(
        spyLogger,
        gasEstimator,
        l1Client,
        l2Client,
        profitabilityCalculator,
        [l1Token.options.address],
        l1Relayer,
        whitelistedChainIds,
        l1DeployData,
        l2DeployData,
        1, // Use small lookback window to test that the back up block search loop runs at least a few times before
        // finding the deposit.
        multicallBundler!
      );
      await Promise.all([l1Client.update(), l2Client.update()]);
      await relayer.checkForPendingDepositsAndRelay();
      assert.isTrue(lastSpyLogIncludes(spy, "No relayable deposits"));

      // Now, relay the deposit.
      await l1Token.methods.mint(l1Owner, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Client.update(); // update L1 client to enable LP fee computation
      const depositData = {
        chainId: chainId,
        depositId: "0",
        l2Sender: l2Depositor,
        l1Recipient: l2Depositor,
        amount: depositAmount,
        slowRelayFeePct: defaultSlowRelayFeePct,
        instantRelayFeePct: defaultInstantRelayFeePct,
        quoteTimestamp: quoteTime,
      };
      await bridgePool.methods
        .relayDeposit(
          depositData,
          await l1Client.calculateRealizedLpFeePctForDeposit({
            amount: depositAmount,
            l1Token: l1Token.options.address,
            quoteTimestamp: quoteTime,
          })
        )
        .send({ from: l1Owner });

      // The relayer should not be able to find the deposit associated with this relay, so it should begin a new search
      // at the relay's quote time where it can find the deposit. This avoids submitting a false dispute.
      await l1Client.update();
      await l1Token.methods.mint(l1Relayer, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Relayer });
      await relayer.checkForPendingRelaysAndDispute();
      await multicallBundler?.send();
      await multicallBundler?.waitForMine();
      const targetLog = spy.getCalls().filter((_log: any) => {
        return _log.lastArg.message.includes("Matched deposit using relay quote time to run new block search");
      });
      assert.equal(targetLog.length, 1);
      assert.isTrue(lastSpyLogIncludes(spy, "Skipping"));
      const disputeEvents = await bridgePool.getPastEvents("RelayDisputed", { fromBlock: 0 });
      assert.equal(disputeEvents.length, 0);
    });
    it("Ignores relay for different whitelisted chain ID than the one set on L2 client", async function () {
      await l1Token.methods.mint(l1Owner, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      const quoteTime = (await web3.eth.getBlock("latest")).timestamp;

      // This relay should be disputed because the deposit doesn't exist on L2, but the disputer should skip it because
      // the L2 client is set for a different chain ID than the one included on the relay, and the chain ID
      // is whitelisted so its a plausibly valid relay.
      await bridgePool.methods
        .relayDeposit(
          {
            chainId: whitelistedChainIds[1], // Different chainID than one used by L2 client, but whitelisted
            depositId: "0",
            l2Sender: l2Depositor,
            l1Recipient: l2Depositor,
            amount: depositAmount,
            slowRelayFeePct: defaultSlowRelayFeePct,
            instantRelayFeePct: defaultInstantRelayFeePct,
            quoteTimestamp: quoteTime,
          },
          toBN(defaultRealizedLpFeePct)
            .mul(toBN(toWei("2")))
            .div(toBN(toWei("1")))
            .toString() // Invalid relay param
        )
        .send({ from: l1Owner });

      // Now, run the disputer and check that it ignores the relay.
      await Promise.all([l1Client.update(), l2Client.update()]);
      await l1Token.methods.mint(l1Relayer, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Relayer });
      await relayer.checkForPendingRelaysAndDispute();
      assert.isTrue(lastSpyLogIncludes(spy, "Relay chain ID is whitelisted but does not match L2 client chain ID"));
      const disputeEvents = await bridgePool.getPastEvents("RelayDisputed", { fromBlock: 0 });
      assert.equal(disputeEvents.length, 0);
    });
    it("Does not dispute valid relay data that contains a valid deposit hash", async function () {
      // Make a deposit on L2 and relay it with valid relay params.
      await l2Token.methods.approve(bridgeDepositBox.options.address, depositAmount).send({ from: l2Depositor });
      const quoteTime = (await web3.eth.getBlock("latest")).timestamp;
      await bridgeDepositBox.methods
        .deposit(
          l2Depositor,
          l2Token.options.address,
          depositAmount,
          defaultSlowRelayFeePct,
          defaultInstantRelayFeePct,
          quoteTime
        )
        .send({ from: l2Depositor });

      // Relay it from the tests to mimic someone else doing the slow relay.
      await l1Token.methods.mint(l1Owner, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Client.update(); // update L1 client to enable LP fee computation
      const depositData = {
        chainId: chainId,
        depositId: "0",
        l2Sender: l2Depositor,
        l1Recipient: l2Depositor,
        amount: depositAmount,
        slowRelayFeePct: defaultSlowRelayFeePct,
        instantRelayFeePct: defaultInstantRelayFeePct,
        quoteTimestamp: quoteTime,
      };
      await bridgePool.methods
        .relayDeposit(
          depositData,
          await l1Client.calculateRealizedLpFeePctForDeposit({
            amount: depositAmount,
            l1Token: l1Token.options.address,
            quoteTimestamp: quoteTime,
          })
        )
        .send({ from: l1Owner });

      // Now, run the disputer and check that it skips the relay.
      await Promise.all([l1Client.update(), l2Client.update()]);
      await l1Token.methods.mint(l1Relayer, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Relayer });
      await relayer.checkForPendingRelaysAndDispute();
      assert.isTrue(lastSpyLogIncludes(spy, "Skipping"));

      // Advance time such that relay has expired and check that bot correctly identifies it as expired.
      const expirationTime = Number(quoteTime.toString()) + defaultLiveness;
      await bridgePool.methods.setCurrentTime(expirationTime).send({ from: l1Owner });
      await l1Client.update();
      await relayer.checkForPendingRelaysAndDispute();
      assert.isTrue(lastSpyLogIncludes(spy, "Pending relay has expired"));

      // Settle relay.
      const relayEvents = (await bridgePool.getPastEvents("DepositRelayed", { fromBlock: 0 }))[0];
      await bridgePool.methods.settleRelay(depositData, relayEvents.returnValues.relay).send({ from: l1Owner });

      // Now try to submit a relay for slightly different deposit data. For example, re-use the deposit ID. This should
      // get disputed as the deposit hash of the duplicate relay no longer exists, even if some specific params
      // are re-used. This basically tests that the Relayer does not lookup deposits just by deposit ID's, but uses the
      // more unique deposit hash as a key.
      await l1Token.methods.mint(l1Owner, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Client.update(); // update L1 client to enable LP fee computation
      await bridgePool.methods
        .relayDeposit(
          {
            ...depositData,
            l1Recipient: l1Owner, // Change this so the deposit hash is different.
          },
          await l1Client.calculateRealizedLpFeePctForDeposit({
            amount: depositAmount,
            l1Token: l1Token.options.address,
            quoteTimestamp: quoteTime,
          })
        )
        .send({ from: l1Owner });

      await l1Client.update();
      await relayer.checkForPendingRelaysAndDispute();
      await multicallBundler?.send();
      await multicallBundler?.waitForMine();
      assert.isTrue(lastSpyLogIncludes(spy, "Disputed pending relay"));
    });
    it("Disputes non-whitelisted chainIDs", async function () {
      // Create Relayer with empty chain ID list, so even valid relay gets disputed.
      const _relayer = new Relayer(
        spyLogger,
        gasEstimator,
        l1Client,
        l2Client,
        profitabilityCalculator,
        [l1Token.options.address],
        l1Relayer,
        [],
        l1DeployData,
        l2DeployData,
        defaultLookbackWindow,
        multicallBundler!
      );

      // Make a deposit on L2 and relay it with valid relay params.
      await l2Token.methods.approve(bridgeDepositBox.options.address, depositAmount).send({ from: l2Depositor });
      const quoteTime = (await web3.eth.getBlock("latest")).timestamp;
      await bridgeDepositBox.methods
        .deposit(
          l2Depositor,
          l2Token.options.address,
          depositAmount,
          defaultSlowRelayFeePct,
          defaultInstantRelayFeePct,
          quoteTime
        )
        .send({ from: l2Depositor });

      // Relay it from the tests to mimic someone else doing the slow relay.
      await l1Token.methods.mint(l1Owner, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Client.update(); // update L1 client to enable LP fee computation
      await bridgePool.methods
        .relayDeposit(
          {
            chainId: chainId, // Same chain ID as L2 client, but not whitelisted.
            depositId: "0",
            l2Sender: l2Depositor,
            l1Recipient: l2Depositor,
            amount: depositAmount,
            slowRelayFeePct: defaultSlowRelayFeePct,
            instantRelayFeePct: defaultInstantRelayFeePct,
            quoteTimestamp: quoteTime,
          },
          await l1Client.calculateRealizedLpFeePctForDeposit({
            amount: depositAmount,
            l1Token: l1Token.options.address,
            quoteTimestamp: quoteTime,
          })
        )
        .send({ from: l1Owner });

      // Now, run the disputer and check that it disputes the relay with a non-whitelisted chain ID.
      await Promise.all([l1Client.update(), l2Client.update()]);
      await l1Token.methods.mint(l1Relayer, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Relayer });
      await _relayer.checkForPendingRelaysAndDispute();
      await multicallBundler?.send();
      await multicallBundler?.waitForMine();
      assert.isTrue(lastSpyLogIncludes(spy, "Disputed pending relay"));

      // This time, submit a relay for a chain ID that isn't used by the L2 client and also isn't on the list of
      // whitelisted chain IDs. The bot should also dispute it.
      await l1Token.methods.mint(l1Owner, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Client.update(); // update L1 client to enable LP fee computation
      await bridgePool.methods
        .relayDeposit(
          {
            chainId: chainId + 1, // Different chain ID from L2 client, and not whitelisted.
            depositId: "0",
            l2Sender: l2Depositor,
            l1Recipient: l2Depositor,
            amount: depositAmount,
            slowRelayFeePct: defaultSlowRelayFeePct,
            instantRelayFeePct: defaultInstantRelayFeePct,
            quoteTimestamp: quoteTime,
          },
          await l1Client.calculateRealizedLpFeePctForDeposit({
            amount: depositAmount,
            l1Token: l1Token.options.address,
            quoteTimestamp: quoteTime,
          })
        )
        .send({ from: l1Owner });

      // Now, run the disputer and check that it disputes the relay with a non-whitelisted chain ID.
      await Promise.all([l1Client.update(), l2Client.update()]);
      await l1Token.methods.mint(l1Relayer, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Relayer });
      await _relayer.checkForPendingRelaysAndDispute();
      await multicallBundler?.send();
      await multicallBundler?.waitForMine();
      assert.isTrue(lastSpyLogIncludes(spy, "Disputed pending relay"));

      const disputeEvents = await bridgePool.getPastEvents("RelayDisputed", { fromBlock: 0 });
      assert.equal(disputeEvents.length, 2);
    });
    it("Quote time too early: disputes relays that bot cannot compute realized LP fee % for", async function () {
      // Deposit using quote time prior to deploy timestamp for this L1 token. We deposit here to make sure
      // that the bot is able to match the relay with a deposit. The bot must then choose to dispute the relay,
      // despite the matching deposit, because its quote time would make computing the realized LP fee impossible.
      const quoteTime = Number(l1DeployData[l1Token.options.address].timestamp) - 1;
      await l2Token.methods.approve(bridgeDepositBox.options.address, depositAmount).send({ from: l2Depositor });
      await bridgeDepositBox.methods
        .deposit(
          l2Depositor,
          l2Token.options.address,
          depositAmount,
          defaultSlowRelayFeePct,
          defaultInstantRelayFeePct,
          quoteTime.toString()
        )
        .send({ from: l2Depositor });

      // Relay the deposit from another slow relayer, and check that the bot disputes the relay
      // specifically because its quote time < deploy timestamp for the pool.
      await l1Token.methods.mint(l1Owner, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await bridgePool.methods
        .relayDeposit(
          {
            chainId: chainId,
            depositId: "0",
            l2Sender: l2Depositor,
            l1Recipient: l2Depositor,
            amount: depositAmount,
            slowRelayFeePct: defaultSlowRelayFeePct,
            instantRelayFeePct: defaultInstantRelayFeePct,
            quoteTimestamp: quoteTime,
          },
          across.feeCalculator.calculateRealizedLpFeePct(rateModel, toWei("0"), toWei("0.01")) // compute the expected fee for 1% utilization
        )
        .send({ from: l1Owner });
      await Promise.all([l1Client.update(), l2Client.update()]);
      await l1Token.methods.mint(l1Relayer, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Relayer });
      await relayer.checkForPendingRelaysAndDispute();
      await multicallBundler?.send();
      await multicallBundler?.waitForMine();
      const targetLog = spy.getCalls().filter((_log: any) => {
        return _log.lastArg.message.includes("Deposit quote time < bridge pool deployment");
      });
      assert.equal(targetLog.length, 1);

      const disputeEvents = await bridgePool.getPastEvents("RelayDisputed", { fromBlock: 0 });
      assert.equal(disputeEvents.length, 1);
    });
    it("Quote time > relay.blockTime: disputes relays that bot cannot compute realized LP fee % for", async function () {
      // Deposit using quote time in future. We deposit here to make sure that the bot is able to match the relay
      // with a deposit. The bot must then choose to dispute the relay, despite the matching deposit, because
      // its quote time would make computing the realized LP fee impossible.
      // Make sure to set a quote time more than the allowable buffer into the future.
      const quoteTime = Number((await web3.eth.getBlock("latest")).timestamp) + 60;
      await l2Token.methods.approve(bridgeDepositBox.options.address, depositAmount).send({ from: l2Depositor });
      await bridgeDepositBox.methods
        .deposit(
          l2Depositor,
          l2Token.options.address,
          depositAmount,
          defaultSlowRelayFeePct,
          defaultInstantRelayFeePct,
          quoteTime.toString()
        )
        .send({ from: l2Depositor });

      // Relay the deposit from another slow relayer, and check that the bot disputes the relay
      // specifically because its quote time is in future.
      await l1Token.methods.mint(l1Owner, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await bridgePool.methods
        .relayDeposit(
          {
            chainId: chainId,
            depositId: "0",
            l2Sender: l2Depositor,
            l1Recipient: l2Depositor,
            amount: depositAmount,
            slowRelayFeePct: defaultSlowRelayFeePct,
            instantRelayFeePct: defaultInstantRelayFeePct,
            quoteTimestamp: quoteTime,
          },
          across.feeCalculator.calculateRealizedLpFeePct(rateModel, toWei("0"), toWei("0.01")) // This realized LP fee computation should
          // be impossible for the relayer to compute since its for a timestamp in the future, therefore the bot should
          // dispute.
        )
        .send({ from: l1Owner });
      await Promise.all([l1Client.update(), l2Client.update()]);
      await l1Token.methods.mint(l1Relayer, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Relayer });
      await relayer.checkForPendingRelaysAndDispute();
      await multicallBundler?.send();
      await multicallBundler?.waitForMine();
      const targetLog = spy.getCalls().filter((_log: any) => {
        return _log.lastArg.message.includes("> relay block time");
      });
      assert.equal(targetLog.length, 1);

      const disputeEvents = await bridgePool.getPastEvents("RelayDisputed", { fromBlock: 0 });
      assert.equal(disputeEvents.length, 1);
    });
    it("Always disputes the largest relay first", async function () {
      // When there are multiple relays with the same amount, the bot should always dispute the largest relay first.
      const quoteTime = Number((await web3.eth.getBlock("latest")).timestamp) + 60;
      // Do 3 relays, the middle relay should be the largest. The disputer should dispute this first. Note that there
      // is no associated L2 deposit so all three are disputable.
      await l1Token.methods.mint(l1Owner, toBN(depositAmount).muln(4)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(4)).send({ from: l1Owner });
      await bridgePool.methods
        .relayDeposit(
          {
            chainId: chainId,
            depositId: "0",
            l2Sender: l2Depositor,
            l1Recipient: l2Depositor,
            amount: depositAmount,
            slowRelayFeePct: defaultSlowRelayFeePct,
            instantRelayFeePct: defaultInstantRelayFeePct,
            quoteTimestamp: quoteTime,
          },
          across.feeCalculator.calculateRealizedLpFeePct(rateModel, toWei("0"), toWei("0.01"))
        )
        .send({ from: l1Owner });
      await bridgePool.methods
        .relayDeposit(
          {
            chainId: chainId,
            depositId: "1",
            l2Sender: l2Depositor,
            l1Recipient: l2Depositor,
            amount: toBN(depositAmount).muln(2).toString(),
            slowRelayFeePct: defaultSlowRelayFeePct,
            instantRelayFeePct: defaultInstantRelayFeePct,
            quoteTimestamp: quoteTime,
          },
          across.feeCalculator.calculateRealizedLpFeePct(rateModel, toWei("0"), toWei("0.01"))
        )
        .send({ from: l1Owner });
      await bridgePool.methods
        .relayDeposit(
          {
            chainId: chainId,
            depositId: "2",
            l2Sender: l2Depositor,
            l1Recipient: l2Depositor,
            amount: depositAmount,
            slowRelayFeePct: defaultSlowRelayFeePct,
            instantRelayFeePct: defaultInstantRelayFeePct,
            quoteTimestamp: quoteTime,
          },
          across.feeCalculator.calculateRealizedLpFeePct(rateModel, toWei("0"), toWei("0.01"))
        )
        .send({ from: l1Owner });

      // Fetch the largest deposit's depositHash. This should be the deposit at index 1 in the array (second deposit).
      const largestDepositDepositHash = (await bridgePool.getPastEvents("DepositRelayed", { fromBlock: 0 }))[1]
        .returnValues.depositHash;

      // Update the clients and check for pending relays. It should dispute all 3 but dispute the largest first.
      await Promise.all([l1Client.update(), l2Client.update()]);
      await l1Token.methods.mint(l1Relayer, toBN(depositAmount).muln(5)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(5)).send({ from: l1Relayer });

      await relayer.checkForPendingRelaysAndDispute();
      await multicallBundler?.send();
      await multicallBundler?.waitForMine();

      const disputeEvents = await bridgePool.getPastEvents("RelayDisputed", { fromBlock: 0 });
      // All three should be disputed.
      assert.equal(disputeEvents.length, 3);

      // Within the contract, the first dispute should be for the deposit hash extracted before for the largest deposit.
      assert.equal(disputeEvents[0].returnValues.depositHash, largestDepositDepositHash);

      // There should be a total of 3 dispute logs generated. within the multicall batch.
      assert.isTrue(lastSpyLogIncludes(spy, "Multicall batch sent"));
      assert.equal(spy.getCall(-1).lastArg.mrkdwn.match(/Disputed pending relay/g).length, 3);
    });
  });
  describe("Multiple whitelisted token mappings", function () {
    let newL1Token: any, newL2Token: any, newBridgePool: any;
    beforeEach(async function () {
      // Whitelist another L1-L2 token mapping:
      newL1Token = await ERC20.new("TESTERC20 2.0", "TESTERC20 2.0", 18).send({ from: l1Owner });
      await newL1Token.methods.addMember(TokenRolesEnum.MINTER, l1Owner).send({ from: l1Owner });
      await collateralWhitelist.methods.addToWhitelist(newL1Token.options.address).send({ from: l1Owner });
      newL2Token = await ERC20.new("L2ERC20 2.0", "L2ERC20 2.0", 18).send({ from: l2Owner });
      await newL2Token.methods.addMember(TokenRolesEnum.MINTER, l2Owner).send({ from: l2Owner });
      newBridgePool = await BridgePool.new(
        "LP Token",
        "LPT",
        bridgeAdmin.options.address,
        newL1Token.options.address,
        lpFeeRatePerSecond,
        false,
        l1Timer.options.address
      ).send({ from: l1Owner });
      await bridgeAdmin.methods
        .whitelistToken(
          chainId,
          newL1Token.options.address,
          newL2Token.options.address,
          newBridgePool.options.address,
          0,
          defaultGasLimit,
          defaultGasPrice,
          0
        )
        .send({ from: l1Owner });
      l1DeployData = {
        ...l1DeployData,
        [newL1Token.options.address]: {
          timestamp: (await l1Timer.methods.getCurrentTime().call()).toString(),
        },
      };
      await bridgeDepositBox.methods
        .whitelistToken(newL1Token.options.address, newL2Token.options.address, newBridgePool.options.address)
        .send({ from: l2BridgeAdminImpersonator });

      // Add liquidity to pools:
      await l1Token.methods.mint(l1LiquidityProvider, initialPoolLiquidity).send({ from: l1Owner });
      await l1Token.methods
        .approve(bridgePool.options.address, initialPoolLiquidity)
        .send({ from: l1LiquidityProvider });
      await bridgePool.methods.addLiquidity(initialPoolLiquidity).send({ from: l1LiquidityProvider });
      await newL1Token.methods.mint(l1LiquidityProvider, initialPoolLiquidity).send({ from: l1Owner });
      await newL1Token.methods
        .approve(newBridgePool.options.address, initialPoolLiquidity)
        .send({ from: l1LiquidityProvider });
      await newBridgePool.methods.addLiquidity(initialPoolLiquidity).send({ from: l1LiquidityProvider });

      // Create new Relayer that is aware of new L1 token:
      const rateModels = { [l1Token.options.address]: rateModel, [newL1Token.options.address]: rateModel };
      await rateModelStore.methods
        .updateRateModel(
          newL1Token.options.address,
          JSON.stringify({
            UBar: rateModels[l1Token.options.address].UBar.toString(),
            R0: rateModels[l1Token.options.address].R0.toString(),
            R1: rateModels[l1Token.options.address].R1.toString(),
            R2: rateModels[l1Token.options.address].R2.toString(),
          })
        )
        .send({ from: l1Owner });

      l1Client = new InsuredBridgeL1Client(
        spyLogger,
        web3,
        bridgeAdmin.options.address,
        rateModelStore.options.address
      );
      l2Client = new InsuredBridgeL2Client(spyLogger, web3, bridgeDepositBox.options.address, chainId);
      // Add the token to the profitability calculator so it has sufficient info to quote the relay type.
      profitabilityCalculator = new MockProfitabilityCalculator(
        spyLogger,
        [l1Token.options.address, newL1Token.options.address],
        1,
        web3,
        100 // 100% discount (ignores profitability calculator)
      );
      profitabilityCalculator.setL1TokenInfo({
        [l1Token.options.address]: { tokenType: TokenType.ERC20, tokenEthPrice: toBNWei("0.1"), decimals: toBN(18) },
        [newL1Token.options.address]: { tokenType: TokenType.ERC20, tokenEthPrice: toBNWei("0.1"), decimals: toBN(18) },
      });
      relayer = new Relayer(
        spyLogger,
        gasEstimator,
        l1Client,
        l2Client,
        profitabilityCalculator,
        [l1Token.options.address, newL1Token.options.address],
        l1Relayer,
        whitelistedChainIds,
        l1DeployData,
        l2DeployData,
        defaultLookbackWindow,
        multicallBundler!
      );

      // Mint and approve tokens for depositor:
      await newL2Token.methods.mint(l2Depositor, depositAmount).send({ from: l2Owner });
      await newL2Token.methods.approve(bridgeDepositBox.options.address, depositAmount).send({ from: l2Depositor });
      await l2Token.methods.mint(l2Depositor, depositAmount).send({ from: l2Owner });
      await l2Token.methods.approve(bridgeDepositBox.options.address, depositAmount).send({ from: l2Depositor });

      // Mint and approve tokens for relayer and disputer:
      await newL1Token.methods.mint(l1Relayer, toBN(depositAmount).muln(4)).send({ from: l1Owner });
      await newL1Token.methods
        .approve(newBridgePool.options.address, toBN(depositAmount).muln(4))
        .send({ from: l1Relayer });
      await l1Token.methods.mint(l1Relayer, toBN(depositAmount).muln(4)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(4)).send({ from: l1Relayer });
    });
    it("Can relay and settle deposits", async function () {
      // Deposit #1
      const quoteTime = (await web3.eth.getBlock("latest")).timestamp;
      const depositData = {
        chainId,
        depositId: "0",
        l1Recipient: l2Depositor,
        l2Sender: l2Depositor,
        amount: depositAmount,
        slowRelayFeePct: defaultSlowRelayFeePct,
        instantRelayFeePct: defaultInstantRelayFeePct,
        quoteTimestamp: quoteTime,
      };
      await bridgeDepositBox.methods
        .deposit(
          depositData.l1Recipient,
          newL2Token.options.address,
          depositData.amount,
          depositData.slowRelayFeePct,
          depositData.instantRelayFeePct,
          depositData.quoteTimestamp
        )
        .send({ from: l2Depositor });

      // Deposit #2
      await bridgeDepositBox.methods
        .deposit(
          depositData.l1Recipient,
          l2Token.options.address,
          depositData.amount,
          depositData.slowRelayFeePct,
          depositData.instantRelayFeePct,
          depositData.quoteTimestamp
        )
        .send({ from: l2Depositor });

      // Update and run the relayer
      await Promise.all([l1Client.update(), l2Client.update()]);
      await relayer.checkForPendingDepositsAndRelay();
      await multicallBundler?.send();
      await multicallBundler?.waitForMine();

      assert.equal((await bridgePool.methods.numberOfRelays().call()).toString(), "1");
      assert.equal((await newBridgePool.methods.numberOfRelays().call()).toString(), "1");

      // Advance time to get the relay into a settable state.
      await l1Timer.methods
        .setCurrentTime(Number((await l1Timer.methods.getCurrentTime().call()) + defaultLiveness + 1))
        .send({ from: l1Owner });

      await Promise.all([l1Client.update(), l2Client.update()]);
      await relayer.checkforSettleableRelaysAndSettle();
      await multicallBundler?.send();
      await multicallBundler?.waitForMine();
      assert.equal((await bridgePool.getPastEvents("RelaySettled", { fromBlock: 0 })).length, 1);
      assert.equal((await newBridgePool.getPastEvents("RelaySettled", { fromBlock: 0 })).length, 1);
    });
    it("Can dispute relays", async function () {
      // Note this test also indirectly validates that the relayer can send two disputes to two separate contracts
      // within the same execution loop.
      const quoteTime = (await web3.eth.getBlock("latest")).timestamp;

      // Invalid relay #1
      await bridgePool.methods
        .relayDeposit(
          {
            chainId: chainId,
            depositId: "99", // deposit ID doesn't exist
            l2Sender: l2Depositor,
            l1Recipient: l2Depositor,
            amount: depositAmount,
            slowRelayFeePct: defaultSlowRelayFeePct,
            instantRelayFeePct: defaultInstantRelayFeePct,
            quoteTimestamp: quoteTime,
          },
          defaultRealizedLpFeePct
        )
        .send({ from: l1Relayer });

      // Invalid relay #2
      await newBridgePool.methods
        .relayDeposit(
          {
            chainId: chainId,
            depositId: "100", // deposit ID doesn't exist
            l2Sender: l2Depositor,
            l1Recipient: l2Depositor,
            amount: depositAmount,
            slowRelayFeePct: defaultSlowRelayFeePct,
            instantRelayFeePct: defaultInstantRelayFeePct,
            quoteTimestamp: quoteTime,
          },
          defaultRealizedLpFeePct
        )
        .send({ from: l1Relayer });

      // Update and run the relayer
      await Promise.all([l1Client.update(), l2Client.update()]);
      await relayer.checkForPendingRelaysAndDispute();
      await multicallBundler?.send();
      await multicallBundler?.waitForMine();

      assert.equal((await bridgePool.getPastEvents("RelayDisputed", { fromBlock: 0 })).length, 1);
      assert.equal((await newBridgePool.getPastEvents("RelayDisputed", { fromBlock: 0 })).length, 1);
    });
  });
  describe("Multicall Batching", function () {
    beforeEach(async function () {
      // Add liquidity to the L1 pool to facilitate the relay action.
      await l1Token.methods.mint(l1LiquidityProvider, initialPoolLiquidity).send({ from: l1Owner });
      await l1Token.methods
        .approve(bridgePool.options.address, initialPoolLiquidity)
        .send({ from: l1LiquidityProvider });
      await bridgePool.methods.addLiquidity(initialPoolLiquidity).send({ from: l1LiquidityProvider });

      // Mint some tokens for the L2 depositor and approve. Mint 2x for the two deposits to be batched.
      await l2Token.methods.mint(l2Depositor, toBN(depositAmount).muln(2)).send({ from: l2Owner });
      await l2Token.methods
        .approve(bridgeDepositBox.options.address, toBN(depositAmount).muln(2))
        .send({ from: l2Depositor });
    });
    it("Can correctly send batch relays and settle relay with multicall", async function () {
      // Before any relays should do nothing and log accordingly.
      await Promise.all([l1Client.update(), l2Client.update()]);
      await relayer.checkForPendingDepositsAndRelay();
      assert.isTrue(lastSpyLogIncludes(spy, "No relayable deposits"));

      // Make two deposits on L2 and check the bot relays them in a batch accordingly.
      const relayTime = await bridgePool.methods.getCurrentTime().call();
      const quoteTime = (await web3.eth.getBlock("latest")).timestamp;
      // Deposit #1
      await bridgeDepositBox.methods
        .deposit(
          l2Depositor,
          l2Token.options.address,
          depositAmount,
          defaultSlowRelayFeePct,
          "0", // set to zero to force slow relay for this test.
          quoteTime
        )
        .send({ from: l2Depositor });

      // Deposit #2
      await bridgeDepositBox.methods
        .deposit(
          l2Depositor,
          l2Token.options.address,
          depositAmount,
          defaultSlowRelayFeePct,
          "0", // set to zero to force slow relay for this test.
          quoteTime
        )
        .send({ from: l2Depositor });

      await Promise.all([l1Client.update(), l2Client.update()]);

      await l1Token.methods.mint(l1Relayer, toBN(depositAmount).muln(4)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(4)).send({ from: l1Relayer });
      await relayer.checkForPendingDepositsAndRelay();
      await multicallBundler?.send();
      await multicallBundler?.waitForMine();

      // The log should also inform that this is a multicall batch.
      assert.isTrue(lastSpyLogIncludes(spy, "Multicall batch sent"));
      // There should be two "slow relay executed" transactions within the batch.
      assert.equal(spy.getCall(-1).lastArg.mrkdwn.match(/Slow Relay executed/g).length, 2);

      // Advance time such that relay has expired and check that bot correctly identifies it as expired.
      const expirationTime = Number(relayTime.toString()) + defaultLiveness;
      await bridgePool.methods.setCurrentTime(expirationTime).send({ from: l1Owner });
      await l1Client.update();
      await relayer.checkForPendingDepositsAndRelay();
      assert.isTrue(lastSpyLogIncludes(spy, "Pending relay has expired"));

      // Finally, settle. We should be able to do both of these in one tx.
      await relayer.checkforSettleableRelaysAndSettle();
      await multicallBundler?.send();
      await multicallBundler?.waitForMine();

      assert.isTrue(lastSpyLogIncludes(spy, "Multicall batch sent"));
      // There should be two "Relay settled" transactions within the batch.
      assert.equal(spy.getCall(-1).lastArg.mrkdwn.match(/Relay settled/g).length, 2);
    });
    it("Can correctly send batch disputes with multicall", async function () {
      // Before any relays should do nothing and log accordingly.
      await Promise.all([l1Client.update(), l2Client.update()]);
      await relayer.checkForPendingRelaysAndDispute();
      assert.isTrue(lastSpyLogIncludes(spy, "No pending relays"));

      // Make two invalid relays. Check the disputer correctly disputes both of them within one transaction.
      const quoteTime = (await web3.eth.getBlock("latest")).timestamp;

      await l1Token.methods.mint(l1Relayer, toBN(depositAmount).muln(10)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(10)).send({ from: l1Relayer });

      // Invalid relay #1
      await bridgePool.methods
        .relayDeposit(
          {
            chainId: chainId,
            depositId: "99", // deposit ID doesn't exist
            l2Sender: l2Depositor,
            l1Recipient: l2Depositor,
            amount: depositAmount,
            slowRelayFeePct: defaultSlowRelayFeePct,
            instantRelayFeePct: defaultInstantRelayFeePct,
            quoteTimestamp: quoteTime,
          },
          defaultRealizedLpFeePct
        )
        .send({ from: l1Relayer });

      // Invalid relay #2
      await bridgePool.methods
        .relayDeposit(
          {
            chainId: chainId,
            depositId: "100", // deposit ID doesn't exist
            l2Sender: l2Depositor,
            l1Recipient: l2Depositor,
            amount: depositAmount,
            slowRelayFeePct: defaultSlowRelayFeePct,
            instantRelayFeePct: defaultInstantRelayFeePct,
            quoteTimestamp: quoteTime,
          },
          defaultRealizedLpFeePct
        )
        .send({ from: l1Relayer });

      await Promise.all([l1Client.update(), l2Client.update()]);

      await relayer.checkForPendingRelaysAndDispute();
      await multicallBundler?.send();
      await multicallBundler?.waitForMine();

      // The log should also inform that this is a multicall batch.
      assert.isTrue(lastSpyLogIncludes(spy, "Multicall batch sent"));
      // There should be two "slow relay executed" transactions within the batch.
      assert.equal(spy.getCall(-1).lastArg.mrkdwn.match(/Disputed pending relay/g).length, 2);

      assert.equal((await bridgePool.getPastEvents("RelayDisputed", { fromBlock: 0 })).length, 2);
    });
  });
});
