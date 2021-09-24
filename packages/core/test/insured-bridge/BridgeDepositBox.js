// These tests are meant to be run within the `hardhat` network (not OVM/AVM). They test the bridge deposit box logic
// and ignore all l2/l1 cross chain admin logic. For those tests see AVM_BridgeDepositBox & OVM_BridgeDepositBox for
// L2 specific unit tests that valid logic pertaining to those chains.

const hre = require("hardhat");
const { getContract, assertEventEmitted } = hre;
const { assert } = require("chai");
const { web3 } = require("hardhat");
const { toWei } = web3.utils;
const { didContractThrow } = require("@uma/common");

// Tested contract
const BridgeDepositBox = getContract("Ownable_BridgeDepositBox");

// Helper contracts
const Token = getContract("ExpandedERC20");
const Timer = getContract("Legacy_Timer");

// Contract objects
let depositBox, l1TokenAddress, l2Token, timer;

// As these tests are in the context of l2, we dont have the deployed notion of an "L1 Token". The L1 token is within
// another domain (L1). To represent this, we can generate a random address to represent the L1 token.
l1TokenAddress = web3.utils.toChecksumAddress(web3.utils.randomHex(20));

const minimumBridgingDelay = 60; // L2->L1 token bridging must wait at least this time.
const depositAmount = toWei("50");
const slowRelayFeePct = toWei("0.005");
const instantRelayFeePct = toWei("0.005");
const quoteTimestampOffset = 60; // 60 seconds into the past.

describe("BridgeDepositBox", () => {
  let accounts, deployer, user1, bridgeAdmin, rando, bridgePool;

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [deployer, user1, bridgeAdmin, rando, bridgePool] = accounts;

    timer = await Timer.new().send({ from: deployer });
  });
  describe("Box deposit logic", () => {
    beforeEach(async function () {
      depositBox = await BridgeDepositBox.new(bridgeAdmin, minimumBridgingDelay, timer.options.address).send({
        from: deployer,
      });

      l2Token = await Token.new("L2 Wrapped Ether", "WETH", 18).send({ from: deployer });
      await l2Token.methods.addMember(1, deployer).send({ from: deployer });

      await l2Token.methods.mint(user1, toWei("100")).send({ from: deployer });

      await depositBox.methods
        .whitelistToken(l1TokenAddress, l2Token.options.address, bridgePool)
        .send({ from: bridgeAdmin });
    });
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
          ev.amount == depositAmount &&
          ev.slowRelayFeePct == slowRelayFeePct &&
          ev.instantRelayFeePct == instantRelayFeePct &&
          ev.quoteTimestamp == quoteTimestamp
        );
      });

      assert.equal(await depositBox.methods.numberOfDeposits().call(), "1"); // Deposit index should increment to 1.
    });

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
            .deposit(user1, l2Token.options.address, depositAmount, slowRelayFeePct, instantRelayFeePct, quoteTimestamp)
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
});
