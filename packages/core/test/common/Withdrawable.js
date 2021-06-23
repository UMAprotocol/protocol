const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract } = hre;
const { didContractThrow } = require("@uma/common");

const WithdrawableTest = getContract("WithdrawableTest");

// Pull in contracts from dependencies.
const Token = getContract("ExpandedERC20");

contract("Withdrawable", function (accounts) {
  let token;

  const owner = accounts[0];
  const rando = accounts[1];

  beforeEach(async function () {
    await runDefaultFixture(hre);
    // Create token contract and mint tokens for use by rando.
    token = await Token.new("Test Synthetic Token", "SYNTH", 18).send({ from: accounts[0] }).send({ from: owner });
    await token.methods.addMember(1, owner).send({ from: owner });
    await token.mint(rando, web3.utils.toWei("100", "ether"), { from: owner });
  });

  it("Withdraw ERC20", async function () {
    const withdrawable = await WithdrawableTest.new().send({ from: accounts[0] });

    // Transfer tokens to the withdrawable address without notifying the contract.
    await token.transfer(withdrawable.options.address, web3.utils.toWei("1.5", "ether"), { from: rando });

    // Attempted to withdraw more than the current balance.
    assert(await didContractThrow(withdrawable.withdrawErc20(token.options.address, web3.utils.toWei("2", "ether"))));

    // Non owner can't withdraw.
    assert(
      await didContractThrow(
        withdrawable.withdrawErc20(token.options.address, web3.utils.toWei("0.5", "ether"), { from: rando })
      )
    );

    // Should only withdraw 0.5 tokens.
    let startingBalance = await token.methods.balanceOf(owner).call();
    await withdrawable.withdrawErc20(token.options.address, web3.utils.toWei("0.5", "ether"));
    let endingBalance = await token.methods.balanceOf(owner).call();
    assert.equal(
      startingBalance.add(web3.utils.toBN(web3.utils.toWei("0.5", "ether"))).toString(),
      endingBalance.toString()
    );

    // Withdraw remaining balance.
    startingBalance = await token.methods.balanceOf(owner).call();
    await withdrawable.withdrawErc20(token.options.address, web3.utils.toWei("1", "ether"));
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
    await withdrawable.pay({ from: rando, value: web3.utils.toWei("1.5", "ether") });

    // Attempted to withdraw more than the current balance.
    assert(await didContractThrow(withdrawable.withdraw(web3.utils.toWei("2", "ether"))));

    // Non owner can't withdraw.
    assert(await didContractThrow(withdrawable.withdraw(web3.utils.toWei("2", "ether"), { from: rando })));

    // Should only withdraw 0.5 tokens.
    let startingBalance = web3.utils.toBN(await web3.eth.getBalance(withdrawable.options.address));
    await withdrawable.withdraw(web3.utils.toWei("0.5", "ether"));
    let endingBalance = web3.utils.toBN(await web3.eth.getBalance(withdrawable.options.address));
    assert.equal(
      startingBalance.sub(web3.utils.toBN(web3.utils.toWei("0.5", "ether"))).toString(),
      endingBalance.toString()
    );

    // Withdraw remaining balance.
    await withdrawable.withdraw(web3.utils.toWei("1", "ether"));
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
