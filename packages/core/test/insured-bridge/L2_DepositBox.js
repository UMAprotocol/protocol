const hre = require("hardhat");
const { didContractThrow } = require("@uma/common");
const { getContract } = hre;

const { assert } = require("chai");

const { deployOptimismContractMock } = require("./helpers/SmockitHelper");

// Tested contract
const BridgeDepositBox = getContract("BridgeDepositBox");

// Contract objects
let depositBox;
let l2CrossDomainMessengerMock;

describe("L2_depositBox", () => {
  let accounts, deployer, user1, l1Owner, l2MessengerImpersonator, rando;

  beforeEach(async function () {
    accounts = await web3.eth.getAccounts();
    [deployer, user1, l1Owner, l2MessengerImpersonator, rando] = accounts;

    l2CrossDomainMessengerMock = await deployOptimismContractMock("OVM_L2CrossDomainMessenger", {
      address: l2MessengerImpersonator,
    });

    depositBox = await BridgeDepositBox.new(l2CrossDomainMessengerMock.options.address, l1Owner).send({
      from: deployer,
    });
  });
  describe("Box Ownership logic", () => {
    it("Transfer ownership", async () => {
      // Owner should start out as the set owner.
      assert.equal(await depositBox.methods.l1Owner().call(), l1Owner);

      // Trying to transfer ownership from non-cross-domain owner should fail.
      assert(await didContractThrow(depositBox.methods.transferL1Owner(user1).send({ from: rando })));

      // Trying to call correctly via the L2 message impersonator, but from the wrong xDomainMessageSender should revert.
      l2CrossDomainMessengerMock.smocked.xDomainMessageSender.will.return.with(() => rando);

      assert(await didContractThrow(depositBox.methods.transferL1Owner(user1).send({ from: l2MessengerImpersonator })));

      // Setting the l2CrossDomainMessengerMock to correctly mock the L1Owner should let the ownership change.
      l2CrossDomainMessengerMock.smocked.xDomainMessageSender.will.return.with(() => l1Owner);

      await depositBox.methods.transferL1Owner(user1).send({ from: l2MessengerImpersonator });

      assert.equal(await depositBox.methods.l1Owner().call(), user1);
    });
  });
});
