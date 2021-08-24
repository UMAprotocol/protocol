const hre = require("hardhat");
const { getContract } = hre;
const { didContractThrow } = require("@uma/common");
const { assert } = require("chai");

const WithdrawableTest = getContract("WithdrawableTest");

// Pull in contracts from dependencies.
const Token = getContract("ExpandedERC20");

describe("Withdrawable", function () {
  let token;
  let accounts;

  let owner;
  let rando;

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, rando] = accounts;
  });

  beforeEach(async function () {
    // Create token contract and mint tokens for use by rando.
    token = await Token.new("Test Synthetic Token", "SYNTH", 18).send({ from: owner });
    await token.methods.addMember(1, owner).send({ from: owner });
    await token.methods.mint(rando, web3.utils.toWei("100", "ether")).send({ from: owner });
  });

  it("Withdraw ERC20", async function () {
    const withdrawable = await WithdrawableTest.new().send({ from: accounts[0] });

    // Transfer tokens to the withdrawable address without notifying the contract.
    await token.methods.transfer(withdrawable.options.address, web3.utils.toWei("1.5", "ether")).send({ from: rando });

    // Attempted to withdraw more than the current balance.
    assert(
      await didContractThrow(
        withdrawable.methods
          .withdrawErc20(token.options.address, web3.utils.toWei("2", "ether"))
          .send({ from: accounts[0] })
      )
    );

    // Non owner can't withdraw.
    assert(
      await didContractThrow(
        withdrawable.methods
          .withdrawErc20(token.options.address, web3.utils.toWei("0.5", "ether"))
          .send({ from: rando })
      )
    );

    // Should only withdraw 0.5 tokens.
    let startingBalance = web3.utils.toBN(await token.methods.balanceOf(owner).call());
    await withdrawable.methods
      .withdrawErc20(token.options.address, web3.utils.toWei("0.5", "ether"))
      .send({ from: accounts[0] });
    let endingBalance = await token.methods.balanceOf(owner).call();
    assert.equal(
      startingBalance.add(web3.utils.toBN(web3.utils.toWei("0.5", "ether"))).toString(),
      endingBalance.toString()
    );

    // Withdraw remaining balance.
    startingBalance = web3.utils.toBN(await token.methods.balanceOf(owner).call());
    await withdrawable.methods
      .withdrawErc20(token.options.address, web3.utils.toWei("1", "ether"))
      .send({ from: accounts[0] });
    endingBalance = await token.methods.balanceOf(owner).call();
    assert.equal(
      startingBalance.add(web3.utils.toBN(web3.utils.toWei("1", "ether"))).toString(),
      endingBalance.toString()
    );
  });

  it("Withdraw ETH", async function () {
    // Note: we must use a contract that can accept payments to test ETH withdrawal.
    const withdrawable = await WithdrawableTest.new().send({ from: accounts[0] });

    // Add 1.5 ETH to the contract.
    await withdrawable.methods.pay().send({ from: rando, value: web3.utils.toWei("1.5", "ether") });

    // Attempted to withdraw more than the current balance.
    assert(
      await didContractThrow(withdrawable.methods.withdraw(web3.utils.toWei("2", "ether")).send({ from: accounts[0] }))
    );

    // Non owner can't withdraw.
    assert(await didContractThrow(withdrawable.methods.withdraw(web3.utils.toWei("2", "ether")).send({ from: rando })));

    // Should only withdraw 0.5 tokens.
    let startingBalance = web3.utils.toBN(await web3.eth.getBalance(withdrawable.options.address));
    await withdrawable.methods.withdraw(web3.utils.toWei("0.5", "ether")).send({ from: accounts[0] });
    let endingBalance = web3.utils.toBN(await web3.eth.getBalance(withdrawable.options.address));
    assert.equal(
      startingBalance.sub(web3.utils.toBN(web3.utils.toWei("0.5", "ether"))).toString(),
      endingBalance.toString()
    );

    // Withdraw remaining balance.
    await withdrawable.methods.withdraw(web3.utils.toWei("1", "ether")).send({ from: accounts[0] });
    endingBalance = web3.utils.toBN(await web3.eth.getBalance(withdrawable.options.address));
    assert.equal(endingBalance.toString(), "0");
  });

  it("Can only set WithdrawRole to a valid role", async function () {
    const withdrawable = await WithdrawableTest.new().send({ from: accounts[0] });

    // can set to 0 (Owner)
    await withdrawable.methods.setInternalWithdrawRole(0).send({ from: accounts[0] });

    // can set to 1 (Voter)
    await withdrawable.methods.setInternalWithdrawRole(1).send({ from: accounts[0] });

    // cant set to anything other than 0 or 1
    assert(await didContractThrow(withdrawable.methods.setInternalWithdrawRole(2).send({ from: accounts[0] })));
  });
});
