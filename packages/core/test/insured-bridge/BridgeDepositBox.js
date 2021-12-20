// These tests are meant to be run within the `hardhat` network (not OVM/AVM). They test the bridge deposit box logic
// and ignore all l2/l1 cross chain admin logic. For those tests see AVM_BridgeDepositBox & OVM_BridgeDepositBox for
// L2 specific unit tests that valid logic pertaining to those chains.

const hre = require("hardhat");
const { getContract, assertEventEmitted } = hre;
const { assert } = require("chai");
const { web3 } = hre;
const { toWei, toChecksumAddress, randomHex } = web3.utils;
const { didContractThrow } = require("@uma/common");

// Tested contract
const BridgeDepositBox = getContract("BridgeDepositBoxMock");

// Helper contracts
const Weth9 = getContract("WETH9");
const Token = getContract("ExpandedERC20");
const Timer = getContract("Timer");

// Contract objects
let depositBox, l2Token, timer;

// As these tests are in the context of l2, we dont have the deployed notion of an "L1 Token". The L1 token is within
// another domain (L1). To represent this, we can generate a random address to represent the L1 token.
const l1TokenAddress = toChecksumAddress(randomHex(20));

// Create a random address to represent WETH on L1.
const l1WethAddress = toChecksumAddress(randomHex(20));

const minimumBridgingDelay = 60; // L2->L1 token bridging must wait at least this time.
const depositAmount = toWei("50");
const slowRelayFeePct = toWei("0.005");
const instantRelayFeePct = toWei("0.005");
const quoteTimestampOffset = 60; // 60 seconds into the past.

describe("BridgeDepositBox", () => {
  let accounts, deployer, user1, bridgeAdmin, bridgePool, l2Weth;

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [deployer, user1, bridgeAdmin, bridgePool] = accounts;

    timer = await Timer.new().send({ from: deployer });
  });
  describe("Box deposit logic", () => {
    beforeEach(async function () {
      depositBox = await BridgeDepositBox.new(
        bridgeAdmin,
        minimumBridgingDelay,
        l1WethAddress,
        timer.options.address
      ).send({ from: deployer });

      l2Token = await Token.new("L2 Wrapped Ether", "WETH", 18).send({ from: deployer });
      await l2Token.methods.addMember(1, deployer).send({ from: deployer });

      await l2Token.methods.mint(user1, toWei("100")).send({ from: deployer });

      await depositBox.methods
        .whitelistToken(l1TokenAddress, l2Token.options.address, bridgePool)
        .send({ from: bridgeAdmin });
    });
    describe("ERC20 deposit logic", () => {
      it("Token flow, events and actions occur correctly on deposit", async () => {
        assert.equal(await depositBox.methods.numberOfDeposits().call(), "0"); // Deposit index should start at 0.

        await l2Token.methods.approve(depositBox.options.address, toWei("100")).send({ from: user1 });

        assert.equal((await l2Token.methods.balanceOf(depositBox.options.address).call()).toString(), "0");

        const quoteTimestamp = Number(await timer.methods.getCurrentTime().call()) - quoteTimestampOffset;
        const tx = await depositBox.methods
          .deposit(user1, l2Token.options.address, depositAmount, slowRelayFeePct, instantRelayFeePct, quoteTimestamp)
          .send({ from: user1 });

        assert.equal((await l2Token.methods.balanceOf(depositBox.options.address).call()).toString(), depositAmount);

        await assertEventEmitted(tx, depositBox, "FundsDeposited", (ev) => {
          return (
            ev.chainId == "10" &&
            ev.depositId == "0" &&
            ev.l1Recipient == user1 &&
            ev.l2Sender == user1 &&
            ev.l1Token == l1TokenAddress &&
            ev.l2Token == l2Token.options.address &&
            ev.amount == depositAmount &&
            ev.slowRelayFeePct == slowRelayFeePct &&
            ev.instantRelayFeePct == instantRelayFeePct &&
            ev.quoteTimestamp == quoteTimestamp
          );
        });

        assert.equal(await depositBox.methods.numberOfDeposits().call(), "1"); // Deposit index should increment to 1.
      });
    });

    describe("Eth deposit logic", () => {
      beforeEach(async function () {
        // Depositing with a msg.value should wrap ETH into this weth token, which should be bridged.
        l2Weth = await Weth9.new().send({ from: deployer });

        // Whitelist the l1WethAddress as the L1 token. to indicate to the contract that this is WETH and should be
        // withdrawn on L1 as an ETH transfer to the recipient.
        await depositBox.methods
          .whitelistToken(l1WethAddress, l2Weth.options.address, bridgePool)
          .send({ from: bridgeAdmin });

        // Contract has no weth before and no eth balance.
        assert.equal((await l2Weth.methods.balanceOf(depositBox.options.address).call()).toString(), "0");
        assert.equal((await web3.eth.getBalance(depositBox.options.address)).toString(), "0");
      });

      it("Can correctly deposit ETH, which is wrapped to WETH and bridged as a normal token", async () => {
        const quoteTimestamp = Number(await timer.methods.getCurrentTime().call()) - quoteTimestampOffset;
        const tx = await depositBox.methods
          .deposit(user1, l2Weth.options.address, depositAmount, slowRelayFeePct, instantRelayFeePct, quoteTimestamp)
          .send({ from: user1, value: depositAmount });

        // Contract should have depositAmount of weth after the deposit call and no eth (it was wrapped).
        assert.equal((await l2Weth.methods.balanceOf(depositBox.options.address).call()).toString(), depositAmount);
        assert.equal((await web3.eth.getBalance(depositBox.options.address)).toString(), "0");

        await assertEventEmitted(tx, depositBox, "FundsDeposited", (ev) => {
          return (
            ev.chainId == "10" &&
            ev.depositId == "0" &&
            ev.l1Recipient == user1 &&
            ev.l2Sender == user1 &&
            ev.l1Token == l1WethAddress &&
            ev.l2Token == l2Weth.options.address &&
            ev.amount == depositAmount &&
            ev.slowRelayFeePct == slowRelayFeePct &&
            ev.instantRelayFeePct == instantRelayFeePct &&
            ev.quoteTimestamp == quoteTimestamp
          );
        });

        assert.equal(await depositBox.methods.numberOfDeposits().call(), "1"); // Deposit index should increment to 1.
      });

      it("Can correctly deposit WETH, which is treated as a normal ERC20 token and bridged", async () => {
        // Deposit eth into Weth for the user.
        await l2Weth.methods.deposit().send({ from: user1, value: depositAmount });

        const quoteTimestamp = Number(await timer.methods.getCurrentTime().call()) - quoteTimestampOffset;

        // Send the deposit tx. this time the `value` is 0. Contract should pull the users WETH amount.
        await l2Weth.methods.approve(depositBox.options.address, depositAmount).send({ from: user1 });
        const tx = await depositBox.methods
          .deposit(user1, l2Weth.options.address, depositAmount, slowRelayFeePct, instantRelayFeePct, quoteTimestamp)
          .send({ from: user1 });

        // Contract should have depositAmount of weth after the deposit call and no eth (it was wrapped).
        assert.equal((await l2Weth.methods.balanceOf(depositBox.options.address).call()).toString(), depositAmount);
        assert.equal((await web3.eth.getBalance(depositBox.options.address)).toString(), "0");

        await assertEventEmitted(tx, depositBox, "FundsDeposited", (ev) => {
          return (
            ev.chainId == "10" &&
            ev.depositId == "0" &&
            ev.l1Recipient == user1 &&
            ev.l2Sender == user1 &&
            ev.l1Token == l1WethAddress &&
            ev.l2Token == l2Weth.options.address &&
            ev.amount == depositAmount &&
            ev.slowRelayFeePct == slowRelayFeePct &&
            ev.instantRelayFeePct == instantRelayFeePct &&
            ev.quoteTimestamp == quoteTimestamp
          );
        });

        assert.equal(await depositBox.methods.numberOfDeposits().call(), "1"); // Deposit index should increment to 1.
      });
      it("Reverts on amount/msg.value mismatch for Eth deposits", async () => {
        // If the user wants to deposit eth but the amount does not match to this value, the tx should revert.
        const quoteTimestamp = Number(await timer.methods.getCurrentTime().call()) - quoteTimestampOffset;
        assert(
          await didContractThrow(
            depositBox.methods
              .deposit(
                user1,
                l2Weth.options.address,
                100, // some value different to depositAmount
                slowRelayFeePct,
                instantRelayFeePct,
                quoteTimestamp
              )
              .send({ from: user1, value: depositAmount })
          )
        );
      });
    });

    describe("Access control and bad deposit checks", () => {
      it("Reverts on non-whitelisted token", async () => {
        const l2Token_nonWhitelisted = await Token.new("L2 Wrapped Ether", "WETH", 18).send({ from: deployer });
        await l2Token_nonWhitelisted.methods.addMember(1, deployer).send({ from: deployer });
        await l2Token_nonWhitelisted.methods.mint(user1, toWei("100")).send({ from: deployer });

        await l2Token_nonWhitelisted.methods.approve(depositBox.options.address, toWei("100")).send({ from: user1 });

        const quoteTimestamp = Number(await timer.methods.getCurrentTime().call()) + quoteTimestampOffset;
        assert(
          await didContractThrow(
            depositBox.methods
              .deposit(
                user1,
                l2Token_nonWhitelisted.options.address,
                depositAmount,
                slowRelayFeePct,
                instantRelayFeePct,
                quoteTimestamp
              )
              .send({ from: user1 })
          )
        );
      });
      it("Reverts if deposits disabled", async () => {
        // Disable deposits
        await depositBox.methods.setEnableDeposits(l2Token.options.address, false).send({ from: bridgeAdmin });

        // Try to deposit and check it reverts.
        await l2Token.methods.approve(depositBox.options.address, toWei("100")).send({ from: user1 });
        const quoteTimestamp = Number(await timer.methods.getCurrentTime().call()) + quoteTimestampOffset;
        assert(
          await didContractThrow(
            depositBox.methods
              .deposit(
                user1,
                l2Token.options.address,
                depositAmount,
                slowRelayFeePct,
                instantRelayFeePct,
                quoteTimestamp
              )
              .send({ from: user1 })
          )
        );
      });
      it("Reverts if slow and instant relay fees exceed individually exceed 25%", async () => {
        // Try to deposit and check it reverts.
        const quoteTimestamp = Number(await timer.methods.getCurrentTime().call()) + quoteTimestampOffset;
        await l2Token.methods.approve(depositBox.options.address, toWei("100")).send({ from: user1 });
        assert(
          await didContractThrow(
            depositBox.methods
              .deposit(user1, l2Token.options.address, depositAmount, toWei("0.24"), toWei("0.26"), quoteTimestamp)
              .send({ from: user1 })
          )
        );
        assert(
          await didContractThrow(
            depositBox.methods
              .deposit(user1, l2Token.options.address, depositAmount, toWei("0.26"), toWei("0.24"), quoteTimestamp)
              .send({ from: user1 })
          )
        );
        await depositBox.methods
          .deposit(user1, l2Token.options.address, depositAmount, toWei("0.24"), toWei("0.24"), quoteTimestamp)
          .send({ from: user1 });
      });
    });

    describe("Basic checks", () => {
      it("canBridge and isWhitelistToken", async () => {
        assert.equal(await depositBox.methods.isWhitelistToken(l1TokenAddress).call(), false);
        assert.equal(
          await depositBox.methods.canBridge(l1TokenAddress).call(),
          false,
          "Should return false for non-whitelisted token"
        );
        assert.equal(await depositBox.methods.isWhitelistToken(l2Token.options.address).call(), true);
        assert.equal(
          await depositBox.methods.canBridge(l2Token.options.address).call(),
          false,
          "Should return false for whitelisted with not enough time elapsed since whitelisting"
        );

        // Advance time past minimum bridging delay and then try again
        await timer.methods
          .setCurrentTime(Number(await timer.methods.getCurrentTime().call()) + minimumBridgingDelay + 1)
          .send({ from: deployer });
        assert.equal(await depositBox.methods.canBridge(l2Token.options.address).call(), true);
        assert.equal(
          await depositBox.methods.canBridge(l1TokenAddress).call(),
          false,
          "Should return false for non-whitelisted token"
        );
      });
    });
  });
});
