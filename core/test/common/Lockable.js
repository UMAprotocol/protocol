const { didContractThrow } = require("../../../common/SolidityTestUtils.js");

const ReentrancyMock = artifacts.require("ReentrancyMock");
const ReentrancyAttack = artifacts.require("ReentrancyAttack");

// Extends https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v3.0.1/test/utils/ReentrancyGuard.test.js.
contract("Lockable", function(accounts) {
  let reentrancyMock;
  describe("nonReentrant and nonReentrant modifiers", function() {
    beforeEach(async function() {
      reentrancyMock = await ReentrancyMock.new();
      assert.equal((await reentrancyMock.counter()).toString(), "0");
    });

    it("should not allow remote callback to a state-changing function", async function() {
      const attacker = await ReentrancyAttack.new();
      assert(await didContractThrow(reentrancyMock.countAndSend(attacker.address)));
    });

    it("should not allow remote callback to a view-only function", async function() {
      const attacker = await ReentrancyAttack.new();
      assert(await didContractThrow(reentrancyMock.countAndCall(attacker.address)));
    });

    // The following are more side-effects than intended behavior:
    // I put them here as documentation, and to monitor any changes
    // in the side-effects.

    it("should not allow local recursion", async function() {
      assert(await didContractThrow(reentrancyMock.countLocalRecursive(10)));
    });

    it("should not allow indirect local recursion", async function() {
      assert(await didContractThrow(reentrancyMock.countThisRecursive(10)));
    });

    it("should not allow local calls to view-only functions", async function() {
      assert(await didContractThrow(reentrancyMock.countLocalCall()));
    });

    it("should not allow indirect local calls to view-only functions", async function() {
      assert(await didContractThrow(reentrancyMock.countThisCall()));
    });
  });
});
