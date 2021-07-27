const hre = require("hardhat");
const { getContract } = hre;

const { assert } = require("chai");

// Tested contract
const BridgeRouter = getContract("BridgeRouter");

// Contract objects
let brideRouter;

describe("L2_depositBox", () => {
  let accounts, deployer, user1;

  beforeEach(async function () {
    accounts = await web3.eth.getAccounts();
    [deployer, user1] = accounts;

    brideRouter = await BridgeRouter.new(user1, user1, user1, 0).send({ from: deployer });
    console.log("brideRouter", brideRouter.options.address);
  });
  describe("Box Router logic", () => {
    it("Some test", async () => {
      assert.isTrue(true);
    });
  });
});
