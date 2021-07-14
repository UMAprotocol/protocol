const hre = require("hardhat");
const { getContract } = hre;
const { didContractThrow } = require("@uma/common");
const { assert } = require("chai");

const ReentrancyMock = getContract("ReentrancyMock");
const ReentrancyAttack = getContract("ReentrancyAttack");

// Extends https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v3.0.1/test/utils/ReentrancyGuard.test.js.
describe("Lockable", function () {
  let reentrancyMock;
  let accounts;

  describe("nonReentrant and nonReentrant modifiers", function () {
    before(async function () {
      accounts = await web3.eth.getAccounts();
      reentrancyMock = await ReentrancyMock.new().send({ from: accounts[0] });
      assert.equal((await reentrancyMock.methods.counter().call()).toString(), "0");
    });

    it("should not allow remote callback to a state-changing function", async function () {
      const attacker = await ReentrancyAttack.new().send({ from: accounts[0] });
      assert(
        await didContractThrow(
          reentrancyMock.methods.countAndSend(attacker.options.address).send({ from: accounts[0] })
        )
      );
    });

    it("should not allow remote callback to a view-only function", async function () {
      const attacker = await ReentrancyAttack.new().send({ from: accounts[0] });
      assert(
        await didContractThrow(
          reentrancyMock.methods.countAndCall(attacker.options.address).send({ from: accounts[0] })
        )
      );
    });

    // The following are more side-effects than intended behavior:
    // I put them here as documentation, and to monitor any changes
    // in the side-effects.

    it("should not allow local recursion", async function () {
      assert(await didContractThrow(reentrancyMock.methods.countLocalRecursive(10).send({ from: accounts[0] })));
    });

    it("should not allow indirect local recursion", async function () {
      assert(await didContractThrow(reentrancyMock.methods.countThisRecursive(10).send({ from: accounts[0] })));
    });

    it("should not allow local calls to view-only functions", async function () {
      assert(await didContractThrow(reentrancyMock.methods.countLocalCall().send({ from: accounts[0] })));
    });

    it("should not allow indirect local calls to view-only functions", async function () {
      assert(await didContractThrow(reentrancyMock.methods.countThisCall().send({ from: accounts[0] })));
    });
  });
});
