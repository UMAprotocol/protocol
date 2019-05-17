const { didContractThrow } = require("./SolidityTestUtils.js");

const ERC20MintableData = require("openzeppelin-solidity/build/contracts/ERC20Mintable.json");
const truffleAssert = require("truffle-assertions");
const truffleContract = require("truffle-contract");
const ERC20Mintable = truffleContract(ERC20MintableData);
ERC20Mintable.setProvider(web3.currentProvider);
const CentralizedStore = artifacts.require("CentralizedStore");

contract("CentralizedStore", function(accounts) {
  // A deployed instance of the CentralizedStore contract, ready for testing.
  let centralizedStore;

  const owner = accounts[0];
  const derivative = accounts[1];
  const erc20TokenOwner = accounts[2];

  before(async function() {
    centralizedStore = await CentralizedStore.deployed();
  });

  it("Compute fees", async function() {
    // Set a convenient fee for this test case of 10%.
    const result = await centralizedStore.setFixedOracleFeePerSecond(web3.utils.toWei("0.1", "ether"));

    // Should produce an event each time fees are set.
    truffleAssert.eventEmitted(result, "SetFixedOracleFeePerSecond", ev => {
      return ev.newOracleFee.toString() === web3.utils.toWei("0.1", "ether");
    });

    // One second time interval, 2 ether PFC. Expected fee is 0.1*2*1 = 0.2 ether.
    let fees = await centralizedStore.computeOracleFees(100, 101, web3.utils.toWei("2", "ether"));
    assert.equal(fees.toString(), web3.utils.toWei("0.2", "ether"));

    // Ten second time interval, 2 ether PFC. Expected fee is 0.1*2*10 = 2 ether.
    fees = await centralizedStore.computeOracleFees(100, 110, web3.utils.toWei("2", "ether"));
    assert.equal(fees.toString(), web3.utils.toWei("2", "ether"));

    // Change fee to 20%.
    await centralizedStore.setFixedOracleFeePerSecond(web3.utils.toWei("0.2", "ether"));

    // One second time interval, 2 ether PFC. Expected fee is 0.2*2*1 = 0.4 ether.
    fees = await centralizedStore.computeOracleFees(100, 101, web3.utils.toWei("2", "ether"));
    assert.equal(fees.toString(), web3.utils.toWei("0.4", "ether"));

    // Ten second time interval, 2 ether PFC. Expected fee is 0.2*2*10 = 4 ether.
    fees = await centralizedStore.computeOracleFees(100, 110, web3.utils.toWei("2", "ether"));
    assert.equal(fees.toString(), web3.utils.toWei("4", "ether"));

    // Disallow endTime < startTime.
    assert(await didContractThrow(centralizedStore.computeOracleFees(2, 1, 10)));

    // Disallow setting fees higher than 100%.
    assert(await didContractThrow(centralizedStore.setFixedOracleFeePerSecond(web3.utils.toWei("1", "ether"))));

    // Only owner can set fees.
    assert(
      await didContractThrow(
        centralizedStore.setFixedOracleFeePerSecond(web3.utils.toWei("0.1", "ether"), { from: derivative })
      )
    );
  });

  it("Fees in ether", async function() {
    // Verify the starting balance is 0.
    let balance = await web3.eth.getBalance(centralizedStore.address);
    assert.equal(balance.toString(), "0");

    // Can't pay a fee of 0 ether.
    assert(
      await didContractThrow(
        centralizedStore.payOracleFees({ from: derivative, value: web3.utils.toWei("0", "ether") })
      )
    );

    // Send 1 ether to the contract and verify balance.
    await centralizedStore.payOracleFees({ from: derivative, value: web3.utils.toWei("1", "ether") });
    balance = await web3.eth.getBalance(CentralizedStore.address);
    assert.equal(balance.toString(), web3.utils.toWei("1", "ether"));

    // Send a further 2 ether to the contract and verify balance.
    await centralizedStore.payOracleFees({ from: derivative, value: web3.utils.toWei("2", "ether") });
    balance = await web3.eth.getBalance(CentralizedStore.address);
    assert.equal(balance.toString(), web3.utils.toWei("3", "ether"));

    // Only the owner can withdraw.
    assert(await didContractThrow(centralizedStore.withdraw(web3.utils.toWei("0.5", "ether"), { from: derivative })));

    // Withdraw 0.5 ether and verify the  balance.
    await centralizedStore.withdraw(web3.utils.toWei("0.5", "ether"));
    balance = await web3.eth.getBalance(CentralizedStore.address);
    assert.equal(balance.toString(), web3.utils.toWei("2.5", "ether"));

    // Can't withdraw more than the balance.
    assert(await didContractThrow(centralizedStore.withdraw(web3.utils.toWei("10", "ether"))));

    // Withdraw remaining balance.
    await centralizedStore.withdraw(web3.utils.toWei("2.5", "ether"));
    balance = await web3.eth.getBalance(CentralizedStore.address);
    assert.equal(balance.toString(), web3.utils.toWei("0", "ether"));
  });

  it("Fees in ERC20", async function() {
    const firstMarginToken = await ERC20Mintable.new({ from: erc20TokenOwner });
    const secondMarginToken = await ERC20Mintable.new({ from: erc20TokenOwner });

    // Mint 100 tokens of each to the contract and verify balances.
    await firstMarginToken.mint(derivative, web3.utils.toWei("100", "ether"), { from: erc20TokenOwner });
    let firstTokenBalanceInStore = await firstMarginToken.balanceOf(centralizedStore.address);
    let firstTokenBalanceInDerivative = await firstMarginToken.balanceOf(derivative);
    assert.equal(firstTokenBalanceInStore, 0);
    assert.equal(firstTokenBalanceInDerivative, web3.utils.toWei("100", "ether"));

    await secondMarginToken.mint(derivative, web3.utils.toWei("100", "ether"), { from: erc20TokenOwner });
    let secondTokenBalanceInStore = await secondMarginToken.balanceOf(centralizedStore.address);
    let secondTokenBalanceInDerivative = await secondMarginToken.balanceOf(derivative);
    assert.equal(secondTokenBalanceInStore, 0);
    assert.equal(secondTokenBalanceInDerivative, web3.utils.toWei("100", "ether"));

    // Pay 10 of the first margin token to the CentralizedStore and verify balances.
    await firstMarginToken.approve(centralizedStore.address, web3.utils.toWei("10", "ether"), { from: derivative });
    await centralizedStore.payOracleFeesErc20(firstMarginToken.address, { from: derivative });
    firstTokenBalanceInStore = await firstMarginToken.balanceOf(centralizedStore.address);
    firstTokenBalanceInDerivative = await firstMarginToken.balanceOf(derivative);
    assert.equal(firstTokenBalanceInStore.toString(), web3.utils.toWei("10", "ether"));
    assert.equal(firstTokenBalanceInDerivative.toString(), web3.utils.toWei("90", "ether"));

    // Pay 20 of the second margin token to the CentralizedStore and verify balances.
    await secondMarginToken.approve(centralizedStore.address, web3.utils.toWei("20", "ether"), { from: derivative });
    await centralizedStore.payOracleFeesErc20(secondMarginToken.address, { from: derivative });
    secondTokenBalanceInStore = await secondMarginToken.balanceOf(centralizedStore.address);
    secondTokenBalanceInDerivative = await secondMarginToken.balanceOf(derivative);
    assert.equal(secondTokenBalanceInStore.toString(), web3.utils.toWei("20", "ether"));
    assert.equal(secondTokenBalanceInDerivative.toString(), web3.utils.toWei("80", "ether"));

    // Withdraw 15 (out of 20) of the second margin token and verify balances.
    await centralizedStore.withdrawErc20(secondMarginToken.address, web3.utils.toWei("15", "ether"), { from: owner });
    let secondTokenBalanceInOwner = await secondMarginToken.balanceOf(owner);
    secondTokenBalanceInStore = await secondMarginToken.balanceOf(centralizedStore.address);
    assert.equal(secondTokenBalanceInOwner.toString(), web3.utils.toWei("15", "ether"));
    assert.equal(secondTokenBalanceInStore.toString(), web3.utils.toWei("5", "ether"));

    // Only owner can withdraw.
    assert(
      await didContractThrow(
        centralizedStore.withdrawErc20(secondMarginToken.address, web3.utils.toWei("5", "ether"), { from: derivative })
      )
    );

    // Can't withdraw more than the balance.
    assert(
      await didContractThrow(
        centralizedStore.withdrawErc20(secondMarginToken.address, web3.utils.toWei("100", "ether"), { from: owner })
      )
    );

    // Withdraw remaining amounts and verify balancse.
    await centralizedStore.withdrawErc20(firstMarginToken.address, web3.utils.toWei("10", "ether"), { from: owner });
    await centralizedStore.withdrawErc20(secondMarginToken.address, web3.utils.toWei("5", "ether"), { from: owner });

    let firstTokenBalanceInOwner = await firstMarginToken.balanceOf(owner);
    firstTokenBalanceInStore = await firstMarginToken.balanceOf(centralizedStore.address);
    assert.equal(firstTokenBalanceInOwner.toString(), web3.utils.toWei("10", "ether"));
    assert.equal(firstTokenBalanceInStore.toString(), web3.utils.toWei("0", "ether"));

    secondTokenBalanceInOwner = await secondMarginToken.balanceOf(owner);
    secondTokenBalanceInStore = await secondMarginToken.balanceOf(centralizedStore.address);
    assert.equal(secondTokenBalanceInOwner.toString(), web3.utils.toWei("20", "ether"));
    assert.equal(secondTokenBalanceInStore.toString(), web3.utils.toWei("0", "ether"));
  });
});
