const { web3, getContract } = require("hardhat");
const { assert } = require("chai");
const { didContractRevertWith } = require("../dist/SolidityTestUtils");

const ExpandedERC20 = getContract("ExpandedERC20");

describe("SolidityTestUtils.js", function () {
  let accounts;
  before(async function () {
    accounts = await web3.eth.getAccounts();
  });
  it("didContractRevertWith", async function () {
    const erc20Contract = await ExpandedERC20.new("Test", "TEST", 18).send({ from: accounts[0] });

    // Mint 1 wei to owner.
    await erc20Contract.methods.addMinter(accounts[0]).send({ from: accounts[0] });
    await erc20Contract.methods.mint(accounts[0], "1").send({ from: accounts[0] });

    const transaction = erc20Contract.methods.transferFrom(accounts[0], accounts[1], "1").send({ from: accounts[1] });

    // This should fail because the owner has not approved the transfer.
    assert.isTrue(await didContractRevertWith(transaction, "ERC20: insufficient allowance"));
  });
});
