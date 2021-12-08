const hre = require("hardhat");
const { web3 } = hre;
const { predeploys } = require("@eth-optimism/contracts");
const { didContractThrow } = require("@uma/common");
const { getContract, assertEventEmitted, assertEventNotEmitted } = hre;

const { toWei } = web3.utils;

const { assert } = require("chai");

const { deployContractMock } = require("../helpers/SmockitHelper");

// Tested contract
const BridgeDepositBox = getContract("OVM_OETH_BridgeDepositBox");

// Helper contracts
const Weth9 = getContract("WETH9");
const Token = getContract("ExpandedERC20");
const Timer = getContract("Timer");

// Contract objects
let depositBox, l2CrossDomainMessengerMock, l1TokenAddress, l1WethAddress, timer, l2Weth, l2Token, l2EthAddress;

// As these tests are in the context of l2, we dont have the deployed notion of an "L1 Token". The L1 token is within
// another domain (L1). Therefore we can generate random addresses to represent the L1 tokens.
l1TokenAddress = web3.utils.toChecksumAddress(web3.utils.randomHex(20));
l1WethAddress = web3.utils.toChecksumAddress(web3.utils.randomHex(20));

// We don't test whether L2 ETH is sent so we'll set it to a random address and just check that `bridgeTokens` correctly
// calls `StandardBridge.withdrawTo` with the `_l2Token` set to `l2Eth` instead of the `l2Weth` token. This happens
// because the StandardBridge first unwraps `l2Weth --> l2Eth` before bridging it, because the OVM StandardBridge
// cannot handle `l2Weth` at the moment.
l2EthAddress = web3.utils.toChecksumAddress(web3.utils.randomHex(20));

const minimumBridgingDelay = 60; // L2->L1 token bridging must wait at least this time.
const depositAmount = toWei("50");
const slowRelayFeePct = toWei("0.005");
const instantRelayFeePct = toWei("0.005");
const quoteTimestampOffset = 60; // 60 seconds into the past.
const chainId = 10; // Optimism mainnet chain ID.

describe("OVM_OETH_BridgeDepositBox", () => {
  // Account objects
  let accounts, deployer, user1, bridgeAdmin, rando, bridgePool, bridgePoolWeth, wethWrapper;

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [deployer, user1, bridgeAdmin, rando, bridgePool, bridgePoolWeth, wethWrapper] = accounts;

    timer = await Timer.new().send({ from: deployer });
  });

  beforeEach(async function () {
    // Initialize the cross domain massager messenger mock at the address of the OVM pre-deploy. The OVM will always use
    // this address for L1<->L2 messaging. Seed this address with some funds so it can send transactions.
    l2CrossDomainMessengerMock = await deployContractMock("L2CrossDomainMessenger", {
      address: predeploys.L2CrossDomainMessenger,
    });
    await web3.eth.sendTransaction({ from: deployer, to: predeploys.L2CrossDomainMessenger, value: toWei("1") });

    // Deploy and mintL2 token contracts:
    // - WETH
    l2Weth = await Weth9.new().send({ from: deployer });
    await l2Weth.methods.deposit().send({ from: user1, value: toWei("100") });
    // - Normal ERC20
    l2Token = await Token.new("L2 Wrapped Ether", "WETH", 18).send({ from: deployer });
    await l2Token.methods.addMember(1, deployer).send({ from: deployer });
    await l2Token.methods.mint(user1, toWei("100")).send({ from: deployer });

    depositBox = await BridgeDepositBox.new(
      bridgeAdmin,
      minimumBridgingDelay,
      chainId,
      l1WethAddress,
      l2EthAddress,
      wethWrapper,
      timer.options.address
    ).send({ from: deployer });
  });
  describe("WETH: Box bridging logic", () => {
    let l2StandardBridge;
    beforeEach(async function () {
      // Whitelist WETH in the deposit box.
      l2CrossDomainMessengerMock.smocked.xDomainMessageSender.will.return.with(() => bridgeAdmin);
      await depositBox.methods
        .whitelistToken(l1WethAddress, l2Weth.options.address, bridgePoolWeth)
        .send({ from: predeploys.L2CrossDomainMessenger });

      // Setup the l2StandardBridge mock to validate cross-domain bridging occurs as expected.
      l2StandardBridge = await deployContractMock("L2StandardBridge", { address: predeploys.L2StandardBridge });
    });
    it("Can initiate cross-domain bridging action", async () => {
      // Deposit tokens as the user.
      await l2Weth.methods.approve(depositBox.options.address, toWei("100")).send({ from: user1 });

      const quoteTimestamp = Number(await timer.methods.getCurrentTime().call()) + quoteTimestampOffset;
      await depositBox.methods
        .deposit(user1, l2Weth.options.address, depositAmount, slowRelayFeePct, instantRelayFeePct, quoteTimestamp)
        .send({ from: user1 });

      // Advance time enough to enable bridging of this token.
      await timer.methods
        .setCurrentTime(Number(await timer.methods.getCurrentTime().call()) + minimumBridgingDelay + 1)
        .send({ from: deployer });

      const tx = await depositBox.methods.bridgeTokens(l2Weth.options.address, 0).send({ from: rando });

      await assertEventEmitted(tx, depositBox, "TokensBridged", (ev) => {
        return (
          ev.l2Token == l2EthAddress && ev.numberOfTokensBridged == depositAmount && ev.l1Gas == 0 && ev.caller == rando
        );
      });

      // We should be able to check the mock L2 Standard bridge and see that there was a function call to the withdrawTo
      // method called by the Deposit box for the correct token, amount and l1Recipient.
      const tokenBridgingCallsToBridge = l2StandardBridge.smocked.withdrawTo.calls;
      assert.equal(tokenBridgingCallsToBridge.length, 1); // only 1 call
      const call = tokenBridgingCallsToBridge[0];
      assert.equal(call._l2Token, l2EthAddress); // Bridging WETH should unwrap the WETH and bridge l2ETH instead
      // of the l2WETH contract, because the OVM standard bridge cannot handle WETH at the moment.
      assert.equal(call._to, wethWrapper); // Bridging WETH should set WETH wrapper as recipient, not the whitelisted
      // BridgePool contract.
      assert.equal(call._amount.toString(), depositAmount); // right amount. We deposited 50e18.
      assert.equal(call._l1Gas.toString(), 0); // right amount. We deposited 50e18.
      assert.equal(call._data.toString(), "0x"); // right data.

      // Check that WETH.withdraw was called and the expected event was emitted.
      await assertEventEmitted(tx, l2Weth, "Withdrawal", (ev) => {
        return ev.src == depositBox.options.address && ev.wad.toString() == depositAmount;
      });
    });
  });
  describe("Non-WETH ERC20: Box bridging logic", () => {
    let l2StandardBridge;
    beforeEach(async function () {
      // Whitelist the token in the deposit box.
      l2CrossDomainMessengerMock.smocked.xDomainMessageSender.will.return.with(() => bridgeAdmin);
      await depositBox.methods
        .whitelistToken(l1TokenAddress, l2Token.options.address, bridgePool)
        .send({ from: predeploys.L2CrossDomainMessenger });

      // Setup the l2StandardBridge mock to validate cross-domain bridging occurs as expected.
      l2StandardBridge = await deployContractMock("L2StandardBridge", { address: predeploys.L2StandardBridge });
    });
    it("Can initiate cross-domain bridging action", async () => {
      // Deposit tokens as the user.
      await l2Token.methods.approve(depositBox.options.address, toWei("100")).send({ from: user1 });

      const quoteTimestamp = Number(await timer.methods.getCurrentTime().call()) + quoteTimestampOffset;
      await depositBox.methods
        .deposit(user1, l2Token.options.address, depositAmount, slowRelayFeePct, instantRelayFeePct, quoteTimestamp)
        .send({ from: user1 });

      // Advance time enough to enable bridging of this token.
      await timer.methods
        .setCurrentTime(Number(await timer.methods.getCurrentTime().call()) + minimumBridgingDelay + 1)
        .send({ from: deployer });

      const tx = await depositBox.methods.bridgeTokens(l2Token.options.address, 0).send({ from: rando });

      await assertEventEmitted(tx, depositBox, "TokensBridged", (ev) => {
        return (
          ev.l2Token == l2Token.options.address &&
          ev.numberOfTokensBridged == depositAmount &&
          ev.l1Gas == 0 &&
          ev.caller == rando
        );
      });

      // We should be able to check the mock L2 Standard bridge and see that there was a function call to the withdrawTo
      // method called by the Deposit box for the correct token, amount and l1Recipient.
      const tokenBridgingCallsToBridge = l2StandardBridge.smocked.withdrawTo.calls;
      assert.equal(tokenBridgingCallsToBridge.length, 1); // only 1 call
      const call = tokenBridgingCallsToBridge[0];
      assert.equal(call._l2Token, l2Token.options.address); // right token.
      assert.equal(call._to, bridgePool); // right recipient is BridgePool contract, not Weth wrapper.
      assert.equal(call._amount.toString(), depositAmount); // right amount. We deposited 50e18.
      assert.equal(call._l1Gas.toString(), 0); // right amount. We deposited 50e18.
      assert.equal(call._data.toString(), "0x"); // right data.

      // Check that WETH.withdraw was not called.
      await assertEventNotEmitted(tx, l2Weth, "Withdrawal");
    });
    it("Reverts if not enough time elapsed", async () => {
      // Deposit tokens as the user.
      await l2Token.methods.approve(depositBox.options.address, toWei("100")).send({ from: user1 });
      const quoteTimestamp = Number(await timer.methods.getCurrentTime().call()) + quoteTimestampOffset;
      await depositBox.methods
        .deposit(user1, l2Token.options.address, depositAmount, slowRelayFeePct, instantRelayFeePct, quoteTimestamp)
        .send({ from: user1 });

      // Dont advance the timer by minimumBridgingDelay. Should revert.
      assert(await didContractThrow(depositBox.methods.bridgeTokens(l2Token.options.address, 0).send({ from: rando })));
    });
    it("Reverts on bridging 0 tokens", async () => {
      // Don't do any deposits. balance should be zero and should revert as 0 token bridge action.
      assert.equal(await l2Token.methods.balanceOf(depositBox.options.address).call(), "0");

      assert(await didContractThrow(depositBox.methods.bridgeTokens(l2Token.options.address, 0).send({ from: rando })));
    });
    it("Reverts if token not whitelisted", async () => {
      // Create a new ERC20 and mint them directly to he depositBox.. Bridging should fail as not whitelisted.
      const l2Token_nonWhitelisted = await Token.new("L2 Wrapped Ether", "WETH", 18).send({ from: deployer });
      await l2Token_nonWhitelisted.methods.addMember(1, deployer).send({ from: deployer });
      await l2Token_nonWhitelisted.methods.mint(depositBox.options.address, toWei("100")).send({ from: deployer });

      assert(await didContractThrow(depositBox.methods.bridgeTokens(l2Token.options.address, 0).send({ from: rando })));
    });
  });
});
