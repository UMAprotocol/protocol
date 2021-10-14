import {
  SpyTransport,
  InsuredBridgeL1Client,
  InsuredBridgeL2Client,
  lastSpyLogIncludes,
  GasEstimator,
  Deposit,
  ClientRelayState,
  RateModel,
  calculateRealizedLpFeePct,
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
const chainId = 10;
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
const rateModel: RateModel = { UBar: toBNWei("0.65"), R0: toBNWei("0.00"), R1: toBNWei("0.08"), R2: toBNWei("1.00") };

// Tested file
import { Relayer, RelaySubmitType } from "../src/Relayer";

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

    // Add L1-L2 token mapping
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
    l2Client = new InsuredBridgeL2Client(spyLogger, web3, bridgeDepositBox.options.address);

    gasEstimator = new GasEstimator(spyLogger);

    relayer = new Relayer(spyLogger, gasEstimator, l1Client, l2Client, [l1Token.options.address], l1Relayer);
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
    });
    it("Correctly decides when to do nothing relay", async function () {
      // There are two cases where the relayer should do nothing: a) it does not have enough token balance and b) when
      // the relay is already finalized. test each:

      // a) Dont add any tokens to the relayer. The relayer does not have enough to do any action and should do nothing.
      assert.equal(
        await relayer.shouldRelay(deposit, clientRelayState, toBN(defaultRealizedLpFeePct), false),
        RelaySubmitType.Ignore
      );

      // b) Mint tokens to the relayer BUT set the ClientRelayState to Finalized. This is the case once the Relay has
      // already been finalized by another relayer and there is nothing to do. Again, the return should be Ignore.
      await l1Token.methods.mint(l1Relayer, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Relayer });
      clientRelayState = ClientRelayState.Finalized;
      assert.equal(
        await relayer.shouldRelay(deposit, clientRelayState, toBN(defaultRealizedLpFeePct), false),
        RelaySubmitType.Ignore
      );

      // c) Relay is pending and already spedup
      clientRelayState = ClientRelayState.Pending;
      assert.equal(
        await relayer.shouldRelay(deposit, clientRelayState, toBN(defaultRealizedLpFeePct), true),
        RelaySubmitType.Ignore
      );
    });
    it("Correctly decides when to slow relay", async function () {
      // The only time the relayer should decide to do a slow relay is when: a) the relayer has enough tokens, b) the
      // deposit has had no other relayer pick it up and c) the deposit contains a instantRelayFeePct set to 0.

      // Mint tokens, set ClientRelayState to Any and update instantRelayFeePct.
      await l1Token.methods.mint(l1Relayer, toBN(defaultProposerBondPct).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Relayer });
      clientRelayState = ClientRelayState.Uninitialized;
      deposit.instantRelayFeePct = "0";
      assert.equal(
        await relayer.shouldRelay(deposit, clientRelayState, toBN(defaultRealizedLpFeePct), false),
        RelaySubmitType.Slow
      );

      // Validate the negative cases.

      // a) The amount minted to the relayer is enough to cover the proposer bond but not the instant relay. Therefore
      // even if the relay is instantly profitable the relayer should choose to slow relay as it's all it can afford.
      deposit.instantRelayFeePct = toWei("0.05");
      assert.equal(
        await relayer.shouldRelay(deposit, clientRelayState, toBN(defaultRealizedLpFeePct), false),
        RelaySubmitType.Slow
      );

      // b) If the relayer is sent more tokens and instantRelayFeePct is anything greater than zero with the relay this.state.// set to any then the relayer should not propose a slow relay.
      await l1Token.methods.mint(l1Relayer, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      assert.notEqual(
        await relayer.shouldRelay(deposit, clientRelayState, toBN(defaultRealizedLpFeePct), false),
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
        await relayer.shouldRelay(deposit, clientRelayState, toBN(defaultRealizedLpFeePct), false),
        RelaySubmitType.Instant
      );

      // Modifying any of the above 4 conditions should make the bot not instant relay.

      // a) There already exists an instant relayer for this relay.
      assert.notEqual(
        await relayer.shouldRelay(deposit, clientRelayState, toBN(defaultRealizedLpFeePct), true),
        RelaySubmitType.Instant
      );

      // b) ClientRelayState set to SpeedUpOnly
      clientRelayState = ClientRelayState.Pending;
      assert.notEqual(
        await relayer.shouldRelay(deposit, clientRelayState, toBN(defaultRealizedLpFeePct), false),
        RelaySubmitType.Instant
      );

      // c) ClientRelayState set to SpeedUpOnly back to Any and profit set to something that makes instant relay less profit
      clientRelayState = ClientRelayState.Uninitialized;
      deposit.instantRelayFeePct = "0";
      assert.notEqual(
        await relayer.shouldRelay(deposit, clientRelayState, toBN(defaultRealizedLpFeePct), false),
        RelaySubmitType.Instant
      );

      // d) reset the instantRelayFeePct and set the token balance of the relayer to something too little to instant
      deposit.instantRelayFeePct = defaultInstantRelayFeePct;
      await l1Token.methods.transfer(l1Owner, toBN(depositAmount).muln(1.5)).send({ from: l1Relayer });
      assert.notEqual(
        await relayer.shouldRelay(deposit, clientRelayState, toBN(defaultRealizedLpFeePct), false),
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
        await relayer.shouldRelay(deposit, clientRelayState, toBN(defaultRealizedLpFeePct), false),
        RelaySubmitType.SpeedUp
      );

      // Modify above conditions:

      // a) not in SpeedUpOnly State
      clientRelayState = ClientRelayState.Uninitialized;
      assert.notEqual(
        await relayer.shouldRelay(deposit, clientRelayState, toBN(defaultRealizedLpFeePct), false),
        RelaySubmitType.SpeedUp
      );

      // b) reset in  ClientRelayState and bot does not have enough balance.
      clientRelayState = ClientRelayState.Pending;
      await l1Token.methods.transfer(l1Owner, toBN(depositAmount).muln(1.5)).send({ from: l1Relayer });
      assert.notEqual(
        await relayer.shouldRelay(deposit, clientRelayState, toBN(defaultRealizedLpFeePct), false),
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
      const relaytime = await bridgePool.methods.getCurrentTime().call();
      const quoteTime = await bridgeDepositBox.methods.getCurrentTime().call();
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
      // As the relayer does not have enough token balance to do the relay (0 minted) should do nothing .
      await relayer.checkForPendingDepositsAndRelay();
      assert.isTrue(lastSpyLogIncludes(spy, "Not relaying"));

      // Mint the relayer some tokens and try again.
      await l1Token.methods.mint(l1Relayer, toBN(depositAmount).muln(2)).send({ from: l1Owner });
      await l1Token.methods.approve(bridgePool.options.address, toBN(depositAmount).muln(2)).send({ from: l1Relayer });
      await relayer.checkForPendingDepositsAndRelay();
      assert.isTrue(lastSpyLogIncludes(spy, "Slow Relay executed"));

      // Advance time such that relay has expired and check that bot correctly identifies it as expired.
      const expirationTime = Number(relaytime.toString()) + defaultLiveness;
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
    it("Can correctly detect and produce speedup relays", async function () {
      // Make a deposit on L2 and relay it. Then, check the relayer picks this up and speeds up the relay.
      await l2Token.methods.approve(bridgeDepositBox.options.address, depositAmount).send({ from: l2Depositor });
      const currentBlockTime = await bridgeDepositBox.methods.getCurrentTime().call();
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
          chainId,
          "0",
          l2Depositor,
          l2Depositor,
          depositAmount,
          defaultSlowRelayFeePct,
          defaultInstantRelayFeePct,
          currentBlockTime,
          calculateRealizedLpFeePct(rateModel, toBNWei("0"), toBNWei("0.01")) // compute the expected fee for 1% utilization
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
      assert.isTrue(lastSpyLogIncludes(spy, "Slow relay sped up"));

      // Running relayer again ignores and sends appropriate message
      await Promise.all([l1Client.update(), l2Client.update()]);
      await relayer.checkForPendingDepositsAndRelay();
      assert.isTrue(lastSpyLogIncludes(spy, "already sped up"));
    });
    it("Can correctly instantly relay deposits", async function () {
      // Make a deposit on L2 and see that the relayer correctly sends a slow relay and speedup it in the same tx.
      await l2Token.methods.approve(bridgeDepositBox.options.address, depositAmount).send({ from: l2Depositor });
      const currentBlockTime = await bridgeDepositBox.methods.getCurrentTime().call();
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
      assert.isTrue(lastSpyLogIncludes(spy, "Relay instantly sent"));
    });
    it("Does not speedup relays with invalid relay data", async function () {
      // Make a deposit on L2 and relay it with invalid relay params. The relayer should detect that the relay params
      // are invalid and skip it.
      await l2Token.methods.approve(bridgeDepositBox.options.address, depositAmount).send({ from: l2Depositor });
      const relaytime = await bridgePool.methods.getCurrentTime().call();
      const quoteTime = await bridgeDepositBox.methods.getCurrentTime().call();
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
          chainId,
          "0",
          l2Depositor,
          l2Depositor,
          depositAmount,
          defaultSlowRelayFeePct,
          defaultInstantRelayFeePct,
          quoteTime,
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
      const expirationTime = Number(relaytime.toString()) + defaultLiveness;
      await bridgePool.methods.setCurrentTime(expirationTime).send({ from: l1Owner });
      await Promise.all([l1Client.update()]);
      await relayer.checkForPendingDepositsAndRelay();
      assert.isTrue(lastSpyLogIncludes(spy, "Pending relay has expired"));
    });
  });
});
