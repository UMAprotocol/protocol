// These tests are meant to be run within the `hardhat` network (not OVM) and use smockit to mock L2 contracts
// such as the cross domain message bridge ect. The context of all calls, tokens and setup are the mocked L2 network.

const hre = require("hardhat");
const { didContractThrow } = require("@uma/common");
const { getContract, assertEventEmitted } = hre;

const { assert } = require("chai");

const { deployOptimismContractMock } = require("./helpers/SmockitHelper");

// Tested contract
const BridgeDepositBox = getContract("OVM_L2BridgeDepositBox");
const Token = getContract("ExpandedERC20");

// Contract objects
let depositBox, l2CrossDomainMessengerMock, l1TokenAddress, l2Token;

// As these tests are in the context of l2, we dont have the deployed notion of an "L1 Token". The L1 token is within
// another domain (L1). To represent this, we can generate a random address to represent the L1 token.
l1TokenAddress = web3.utils.toChecksumAddress(web3.utils.randomHex(20));

describe("OVM_L2BridgeDepositBox", () => {
  // Account objects
  let accounts, deployer, user1, l1WithdrawContract, l2MessengerImpersonator, rando;

  beforeEach(async function () {
    accounts = await web3.eth.getAccounts();
    [deployer, user1, l1WithdrawContract, l2MessengerImpersonator, rando] = accounts;

    l2CrossDomainMessengerMock = await deployOptimismContractMock("OVM_L2CrossDomainMessenger", {
      address: l2MessengerImpersonator,
    });

    depositBox = await BridgeDepositBox.new(l2CrossDomainMessengerMock.options.address, l1WithdrawContract).send({
      from: deployer,
    });

    l2Token = await Token.new("L2 Wrapped Ether", "WETH", 18).send({ from: deployer });
  });
  describe("Box admin logic", () => {
    // Only the l1WithdrawContract, called via the canonical bridge, can: a) change the L1 withdraw contract,
    // b) whitelist collateral or c) disable deposits. In production, the l1WithdrawContract will be the L1_BridgeRouter.
    // In these tests mock this as being any l1WithdrawContract, calling via the l2MessengerImpersonator.
    it("Change l1 withdraw contract", async () => {
      // Owner should start out as the set owner.
      assert.equal(await depositBox.methods.l1WithdrawContract().call(), l1WithdrawContract);

      // Trying to transfer ownership from non-cross-domain owner should fail.
      assert(await didContractThrow(depositBox.methods.changeL1WithdrawContract(user1).send({ from: rando })));

      // Trying to call correctly via the L2 message impersonator, but from the wrong xDomainMessageSender should revert.
      l2CrossDomainMessengerMock.smocked.xDomainMessageSender.will.return.with(() => rando);

      assert(
        await didContractThrow(
          depositBox.methods.changeL1WithdrawContract(user1).send({ from: l2MessengerImpersonator })
        )
      );

      // Setting the l2CrossDomainMessengerMock to correctly mock the l1WithdrawContract should let the ownership change.
      l2CrossDomainMessengerMock.smocked.xDomainMessageSender.will.return.with(() => l1WithdrawContract);

      const tx = await depositBox.methods.changeL1WithdrawContract(user1).send({ from: l2MessengerImpersonator });

      assert.equal(await depositBox.methods.l1WithdrawContract().call(), user1);

      await assertEventEmitted(tx, depositBox, "L1WithdrawContractChanged", (ev) => {
        return ev.oldL1WithdrawContract == l1WithdrawContract && ev.newL1WithdrawContract == user1;
      });
    });

    it("Whitelist collateral", async () => {
      // Trying to whitelist tokens from something other than the l2MessengerImpersonator should fail.
      assert(
        await didContractThrow(
          depositBox.methods.whitelistToken(l1TokenAddress, l2Token.options.address).send({ from: rando })
        )
      );

      // Trying to call correctly via the L2 message impersonator, but from the wrong xDomainMessageSender should revert.
      l2CrossDomainMessengerMock.smocked.xDomainMessageSender.will.return.with(() => rando);

      assert(
        await didContractThrow(
          depositBox.methods
            .whitelistToken(l1TokenAddress, l2Token.options.address)
            .send({ from: l2MessengerImpersonator })
        )
      );

      // Setting the l2CrossDomainMessengerMock to correctly mock the L1WithdrawContract should let the whitelist change.
      l2CrossDomainMessengerMock.smocked.xDomainMessageSender.will.return.with(() => l1WithdrawContract);

      const tx = await depositBox.methods
        .whitelistToken(l1TokenAddress, l2Token.options.address)
        .send({ from: l2MessengerImpersonator });

      assert.equal(await depositBox.methods.whitelistedTokens(l2Token.options.address).call(), l1TokenAddress);

      await assertEventEmitted(tx, depositBox, "TokenWhitelisted", (ev) => {
        return ev.l1Token == l1TokenAddress && ev.l2Token == l2Token.options.address;
      });
    });

    it("Disable deposits", async () => {
      // Trying to disable tokens from something other than the l2MessengerImpersonator should fail.
      assert(await didContractThrow(depositBox.methods.setEnableDeposits(false).send({ from: rando })));

      // Trying to call correctly via the L2 message impersonator, but from the wrong xDomainMessageSender should revert.
      l2CrossDomainMessengerMock.smocked.xDomainMessageSender.will.return.with(() => rando);

      assert(
        await didContractThrow(depositBox.methods.setEnableDeposits(false).send({ from: l2MessengerImpersonator }))
      );

      // Setting the l2CrossDomainMessengerMock to correctly mock the L1WithdrawContract should let the enable state change.
      l2CrossDomainMessengerMock.smocked.xDomainMessageSender.will.return.with(() => l1WithdrawContract);

      const tx = await depositBox.methods.setEnableDeposits(false).send({ from: l2MessengerImpersonator });

      assert.equal(await depositBox.methods.depositsEnabled().call(), false);

      await assertEventEmitted(tx, depositBox, "DepositsEnabled", (ev) => {
        return ev.enabledResultantState == false;
      });

      // TODO: validate that deposit reverts when disabled.
    });
  });
});
