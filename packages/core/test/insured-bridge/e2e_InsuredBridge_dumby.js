const hre = require("hardhat");
const { getContract } = hre;

const { assert } = require("chai");

// Tested contract
const BridgeDepositBox = getContract("BridgeDepositBox");

// Helper contracts
// const Token = getContract("ExpandedERC20");

// Contract objects
let depositBox;

describe("End To End tests", () => {
  let accounts;

  beforeEach(async function () {
    accounts = await web3.eth.getAccounts();
    depositBox = await BridgeDepositBox.new(accounts[0], accounts[0]).send({ from: accounts[0] });
    console.log("depositBox", depositBox.options.address);
  });
  describe("Cross domain messaging", () => {
    it("Transfer ownership", async () => {
      assert.isTrue(true);
    });
  });
});
