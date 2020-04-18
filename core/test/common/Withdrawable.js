const { didContractThrow } = require("../../../common/SolidityTestUtils.js");

const WithdrawableTest = artifacts.require("WithdrawableTest");

// Pull in contracts from dependencies.
const Token = artifacts.require("ExpandedERC20");

contract("Withdrawable", function(accounts) {
  let token;

  const owner = accounts[0];
  const rando = accounts[1];

  before(async function() {
    // Create token contract and mint tokens for use by rando.
    token = await Token.new("UMA", "UMA", 18, { from: owner });
    await token.addMember(1, owner, { from: owner });
    await token.mint(rando, web3.utils.toWei("100", "ether"), { from: owner });
  });

  it("Withdraw ERC20", async function() {
    const withdrawable = await WithdrawableTest.new();

    // Transfer tokens to the withdrawable address without notifying the contract.
    await token.transfer(withdrawable.address, web3.utils.toWei("1.5", "ether"), { from: rando });

    // Attempted to withdraw more than the current balance.
    assert(await didContractThrow(withdrawable.withdrawErc20(token.address, web3.utils.toWei("2", "ether"))));

    // Non owner can't withdraw.
    assert(
      await didContractThrow(
        withdrawable.withdrawErc20(token.address, web3.utils.toWei("0.5", "ether"), { from: rando })
      )
    );

    // Should only withdraw 0.5 tokens.
    let startingBalance = await token.balanceOf(owner);
    await withdrawable.withdrawErc20(token.address, web3.utils.toWei("0.5", "ether"));
    let endingBalance = await token.balanceOf(owner);
    assert.equal(
      startingBalance.add(web3.utils.toBN(web3.utils.toWei("0.5", "ether"))).toString(),
      endingBalance.toString()
    );

    // Withdraw remaining balance.
    startingBalance = await token.balanceOf(owner);
    await withdrawable.withdrawErc20(token.address, web3.utils.toWei("1", "ether"));
    endingBalance = await token.balanceOf(owner);
    assert.equal(
      startingBalance.add(web3.utils.toBN(web3.utils.toWei("1", "ether"))).toString(),
      endingBalance.toString()
    );
  });

  it("Withdraw ETH", async function() {
    // Note: we must use a contract that can accept payments to test ETH withdrawal.
    const withdrawable = await WithdrawableTest.new();

    // Add 1.5 ETH to the contract.
    await withdrawable.pay({ from: rando, value: web3.utils.toWei("1.5", "ether") });

    // Attempted to withdraw more than the current balance.
    assert(await didContractThrow(withdrawable.withdraw(web3.utils.toWei("2", "ether"))));

    // Non owner can't withdraw.
    assert(await didContractThrow(withdrawable.withdraw(web3.utils.toWei("2", "ether"), { from: rando })));

    // Should only withdraw 0.5 tokens.
    let startingBalance = web3.utils.toBN(await web3.eth.getBalance(withdrawable.address));
    await withdrawable.withdraw(web3.utils.toWei("0.5", "ether"));
    let endingBalance = web3.utils.toBN(await web3.eth.getBalance(withdrawable.address));
    assert.equal(
      startingBalance.sub(web3.utils.toBN(web3.utils.toWei("0.5", "ether"))).toString(),
      endingBalance.toString()
    );

    // Withdraw remaining balance.
    await withdrawable.withdraw(web3.utils.toWei("1", "ether"));
    endingBalance = web3.utils.toBN(await web3.eth.getBalance(withdrawable.address));
    assert.equal(endingBalance.toString(), "0");
  });

  it("Can only set WithdrawRole to a valid role", async function() {
    const withdrawable = await WithdrawableTest.new();

    // can set to 0 (Owner)
    await withdrawable.setInternalWithdrawRole(0);

    // can set to 1 (Voter)
    await withdrawable.setInternalWithdrawRole(1);

    // cant set to anything other than 0 or 1
    assert(await didContractThrow(withdrawable.setInternalWithdrawRole(2)));
  });
});
