const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract, assertEventEmitted } = hre;
const { toWei, utf8ToHex, toBN, padRight } = web3.utils;
const { assert } = require("chai");

const { deployOptimismContractMock } = require("../helpers/utils");

// Tested contract
const BridgeDepositBox = getContract("BridgeDepositBox");

let bridgeDepositBox;
let deployer;
let l2MessengerImpersonator;
let l1Owner;
let l2CrossDomainMessengerMock;

describe("L2_BridgeDepositBox", () => {
  let accounts, deployer, user1, l1Admin, l2MessengerImpersonator, rando;

  beforeEach(async function () {
    accounts = await web3.eth.getAccounts();
    [deployer, user1, l1Admin, l2MessengerImpersonator, rando] = accounts;

    l2CrossDomainMessengerMock = await deployOptimismContractMock("OVM_L2CrossDomainMessenger", {
      address: l2MessengerImpersonator,
    });
    l2CrossDomainMessengerMock.smocked.xDomainMessageSender.will.return.with(() => l1Admin);

    bridgeDepositBox = await BridgeDepositBox.new(l2CrossDomainMessengerMock.options.address, l1Admin).send({
      from: deployer,
    });
  });
  describe("Box Ownership methods", () => {
    it("Transfer ownership", async () => {
      assert.equal(await bridgeDepositBox.methods.l1Owner().call(), l1Owner);

      assert(await didContractThrow(bridgeDepositBox.methods.transferL1Ownership(user1).send({ from: rando })));

      await bridgeDepositBox.methods.transferL1Ownership(user1).send({ from: l2MessengerImpersonator });

      assert.equal(await bridgeDepositBox.methods.l1Owner().call(), user1);
    });
  });
});
