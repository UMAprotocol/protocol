// This set of tests validates the BridgeDepositBox OVM (Optimism) specific logic such as L1->L2 function calls and the
// use of the OVM token bridge. Bridge Deposit logic is not directly tested. For this see the BridgeDepositBox.js tests.

const hre = require("hardhat");
const { web3 } = hre;
const { predeploys } = require("@eth-optimism/contracts");
const { didContractThrow, ZERO_ADDRESS } = require("@uma/common");
const { getContract, assertEventEmitted } = hre;

const { toWei } = web3.utils;

const { assert } = require("chai");

const { deployContractMock } = require("./helpers/SmockitHelper");

// Tested contract
const BridgeDepositBox = getContract("OVM_BridgeDepositBox");

// Helper contracts
const Token = getContract("ExpandedERC20");
const Timer = getContract("Timer");

// Contract objects
let depositBox, l2CrossDomainMessengerMock, l1TokenAddress, l2Token, timer;

// As these tests are in the context of l2, we dont have the deployed notion of an "L1 Token". The L1 token is within
// another domain (L1). To represent this, we can generate a random address to represent the L1 token.
l1TokenAddress = web3.utils.toChecksumAddress(web3.utils.randomHex(20));

const minimumBridgingDelay = 60; // L2->L1 token bridging must wait at least this time.
const depositAmount = toWei("50");
const slowRelayFeePct = toWei("0.005");
const instantRelayFeePct = toWei("0.005");
const quoteTimestampOffset = 60; // 60 seconds into the past.
const chainId = 10; // Optimism mainnet chain ID.

describe("OVM_BridgeDepositBox", () => {
  // Account objects
  let accounts, deployer, user1, bridgeAdmin, rando, bridgePool;

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [deployer, user1, bridgeAdmin, rando, bridgePool] = accounts;

    timer = await Timer.new().send({ from: deployer });
  });

  beforeEach(async function () {
    // Initialize the cross domain massager messenger mock at the address of the OVM pre-deploy. The OVM will always use
    // this address for L1<->L2 messaging. Seed this address with some funds so it can send transactions.
    l2CrossDomainMessengerMock = await deployContractMock("OVM_L2CrossDomainMessenger", {
      address: predeploys.OVM_L2CrossDomainMessenger,
    });
    await web3.eth.sendTransaction({ from: deployer, to: predeploys.OVM_L2CrossDomainMessenger, value: toWei("1") });

    depositBox = await BridgeDepositBox.new(
      bridgeAdmin,
      minimumBridgingDelay,
      chainId,
      ZERO_ADDRESS, // weth address. Weth mode not used in these tests
      timer.options.address
    ).send({ from: deployer });

    l2Token = await Token.new("L2 Wrapped Ether", "WETH", 18).send({ from: deployer });
    await l2Token.methods.addMember(1, deployer).send({ from: deployer });

    // Mint tokens to user
    await l2Token.methods.mint(user1, toWei("100")).send({ from: deployer });
  });
  describe("Box admin logic", () => {
    // Only the crossDomainAdmin, called via the canonical bridge, can: a) change the L1 withdraw contract,
    // b) whitelist collateral or c) disable deposits. In production, the crossDomainAdmin will be the Messenger.
    // In these tests mock this as being any crossDomainAdmin, calling via the l2MessengerImpersonator.
    it("Change L1 admin contract", async () => {
      // Owner should start out as the set owner.
      assert.equal(await depositBox.methods.crossDomainAdmin().call(), bridgeAdmin);

      // Trying to transfer ownership from non-cross-domain owner should fail.
      assert(await didContractThrow(depositBox.methods.setCrossDomainAdmin(user1).send({ from: rando })));

      // Trying to call correctly via the L2 message impersonator, but from the wrong xDomainMessageSender should revert.
      l2CrossDomainMessengerMock.smocked.xDomainMessageSender.will.return.with(() => rando);

      assert(
        await didContractThrow(
          depositBox.methods.setCrossDomainAdmin(user1).send({ from: predeploys.OVM_L2CrossDomainMessenger })
        )
      );

      // Setting the l2CrossDomainMessengerMock to correctly mock the bridgeAdmin shoZuld let the ownership change.
      l2CrossDomainMessengerMock.smocked.xDomainMessageSender.will.return.with(() => bridgeAdmin);

      const tx = await depositBox.methods
        .setCrossDomainAdmin(user1)
        .send({ from: predeploys.OVM_L2CrossDomainMessenger });

      assert.equal(await depositBox.methods.crossDomainAdmin().call(), user1);

      await assertEventEmitted(tx, depositBox, "SetXDomainAdmin", (ev) => {
        return ev.newAdmin == user1;
      });
    });

    it("Set minimum bridging delay", async () => {
      // Bridging delay should be set initially to the correct value.
      assert.equal(await depositBox.methods.minimumBridgingDelay().call(), minimumBridgingDelay);

      // Trying to change bridging delay from non-cross-domain owner should fail.
      assert(await didContractThrow(depositBox.methods.setMinimumBridgingDelay(55).send({ from: rando })));

      // Trying to call correctly via the L2 message impersonator, but from the wrong xDomainMessageSender should revert.
      l2CrossDomainMessengerMock.smocked.xDomainMessageSender.will.return.with(() => rando);

      assert(
        await didContractThrow(
          depositBox.methods.setMinimumBridgingDelay(55).send({ from: predeploys.OVM_L2CrossDomainMessenger })
        )
      );

      // Setting the l2CrossDomainMessengerMock to correctly mock the bridgeAdmin should let the bridging delay change.
      l2CrossDomainMessengerMock.smocked.xDomainMessageSender.will.return.with(() => bridgeAdmin);

      const tx = await depositBox.methods
        .setMinimumBridgingDelay(55)
        .send({ from: predeploys.OVM_L2CrossDomainMessenger });

      assert.equal(await depositBox.methods.minimumBridgingDelay().call(), 55);

      await assertEventEmitted(tx, depositBox, "SetMinimumBridgingDelay", (ev) => {
        return ev.newMinimumBridgingDelay == 55;
      });
    });

    it("Whitelist collateral", async () => {
      // Trying to whitelist tokens from something other than the l2MessengerImpersonator should fail.
      assert(
        await didContractThrow(
          depositBox.methods.whitelistToken(l1TokenAddress, l2Token.options.address, bridgePool).send({ from: rando })
        )
      );

      // Trying to call correctly via the L2 message impersonator, but from the wrong xDomainMessageSender should revert.
      l2CrossDomainMessengerMock.smocked.xDomainMessageSender.will.return.with(() => rando);

      assert(
        await didContractThrow(
          depositBox.methods
            .whitelistToken(l1TokenAddress, l2Token.options.address, bridgePool)
            .send({ from: predeploys.OVM_L2CrossDomainMessenger })
        )
      );

      // Setting the l2CrossDomainMessengerMock to correctly mock the L1WithdrawContract should let the whitelist change.
      l2CrossDomainMessengerMock.smocked.xDomainMessageSender.will.return.with(() => bridgeAdmin);

      const tx = await depositBox.methods
        .whitelistToken(l1TokenAddress, l2Token.options.address, bridgePool)
        .send({ from: predeploys.OVM_L2CrossDomainMessenger });

      assert.equal(
        (await depositBox.methods.whitelistedTokens(l2Token.options.address).call()).l1Token,
        l1TokenAddress
      );

      const expectedLastBridgeTime = await timer.methods.getCurrentTime().call();
      await assertEventEmitted(tx, depositBox, "WhitelistToken", (ev) => {
        return (
          ev.l1Token == l1TokenAddress &&
          ev.l2Token == l2Token.options.address &&
          ev.lastBridgeTime == expectedLastBridgeTime &&
          ev.bridgePool == bridgePool
        );
      });
    });

    it("Disable deposits", async () => {
      // Trying to disable tokens from something other than the l2MessengerImpersonator should fail.
      assert(
        await didContractThrow(
          depositBox.methods.setEnableDeposits(l2Token.options.address, false).send({ from: rando })
        )
      );

      // Trying to call correctly via the L2 message impersonator, but from the wrong xDomainMessageSender should revert.
      l2CrossDomainMessengerMock.smocked.xDomainMessageSender.will.return.with(() => rando);

      assert(
        await didContractThrow(
          depositBox.methods
            .setEnableDeposits(l2Token.options.address, false)
            .send({ from: predeploys.OVM_L2CrossDomainMessenger })
        )
      );

      // Setting the l2CrossDomainMessengerMock to correctly mock the L1WithdrawContract should let the enable state change.
      l2CrossDomainMessengerMock.smocked.xDomainMessageSender.will.return.with(() => bridgeAdmin);

      const tx = await depositBox.methods
        .setEnableDeposits(l2Token.options.address, false)
        .send({ from: predeploys.OVM_L2CrossDomainMessenger });

      assert.equal((await depositBox.methods.whitelistedTokens(l2Token.options.address).call()).depositsEnabled, false);

      await assertEventEmitted(tx, depositBox, "DepositsEnabled", (ev) => {
        return ev.l2Token === l2Token.options.address && ev.depositsEnabled == false;
      });
    });
  });
  describe("Box bridging logic", () => {
    let l2StandardBridge;
    beforeEach(async function () {
      // Whitelist the token in the deposit box.
      l2CrossDomainMessengerMock.smocked.xDomainMessageSender.will.return.with(() => bridgeAdmin);
      await depositBox.methods
        .whitelistToken(l1TokenAddress, l2Token.options.address, bridgePool)
        .send({ from: predeploys.OVM_L2CrossDomainMessenger });

      // Setup the l2StandardBridge mock to validate cross-domain bridging occurs as expected.
      l2StandardBridge = await deployContractMock("OVM_L2StandardBridge", { address: predeploys.OVM_L2StandardBridge });
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
      assert.equal(call._to, bridgePool); // right recipient.
      assert.equal(call._amount.toString(), depositAmount); // right amount. We deposited 50e18.
      assert.equal(call._l1Gas.toString(), 0); // right amount. We deposited 50e18.
      assert.equal(call._data.toString(), "0x"); // right data.
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
