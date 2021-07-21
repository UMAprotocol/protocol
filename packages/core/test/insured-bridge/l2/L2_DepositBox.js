const { getContractDefinition } = require("@eth-optimism/contracts");
const { smockit } = require("@eth-optimism/smock");

const { didContractThrow } = require("@uma/common");

const { assert, expect } = require("chai");

const hre = require("hardhat");
const { getContract, assertEventEmitted, ethers } = hre;

// Tested contract
const DepositBox = getContract("DepositBox");

async function deployOptimismContractMock(name, opts) {
  const artifact = getContractDefinition(name);

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode);
  return await smockit(factory, opts);
}

async function deploy(name, args) {
  const factory = await ethers.getContractFactory(name);
  return factory.deploy(...(args || []));
}

let depositBox;
let deployer;
let l2MessengerImpersonator;
let l1Owner;
let l2CrossDomainMessengerMock;

describe("L2_DepositBox", () => {
  beforeEach(async function () {
    [deployer, l2MessengerImpersonator, l1Owner, user1] = await ethers.getSigners();

    l2CrossDomainMessengerMock = await deployOptimismContractMock("OVM_L2CrossDomainMessenger", {
      address: await l2MessengerImpersonator.getAddress(),
    });
    console.log("l2CrossDomainMessengerMock", l2CrossDomainMessengerMock.address);
    depositBox = await deploy("BridgeDepositBox", [l2CrossDomainMessengerMock.address, await l1Owner.getAddress()]);
    console.log("depositBox", depositBox);
  });
  describe("Box Ownership methods", () => {
    it("Transfer ownership", async () => {
      console.log("depositBox", depositBox);
      console.log("owner", await depositBox.l1Owner());
      assert.equal(await depositBox.l1Owner(), await l1Owner.getAddress());
      //   await expect(depositBox.connect(user1).transferL1Ownership(await user1.getAddress())).to.be.revertedWith(
      //     "OVM_XCHAIN: messenger contract unauthenticated"
      //   );

      console.log("A");
      assert(await didContractThrow(depositBox.connect(user1).transferL1Ownership(await user1.getAddress())));
      console.log("b");

      l2CrossDomainMessengerMock.smocked.xDomainMessageSender.will.return.with(async () => await l1Owner.getAddress());
      console.log("c");
      await depositBox.connect(l2MessengerImpersonator).transferL1Ownership(await user1.getAddress());
      console.log("d");
      //   await expect(depositBox.connect(user1).transferL1Ownership(user1)).to.be.reverted();
    });
  });
});
