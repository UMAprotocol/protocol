const { didContractThrow } = require("../../common/SolidityTestUtils.js");

const ERC20MintableData = require("openzeppelin-solidity/build/contracts/ERC20Mintable.json");
const truffleAssert = require("truffle-assertions");
const truffleContract = require("truffle-contract");
const ERC20Mintable = truffleContract(ERC20MintableData);
ERC20Mintable.setProvider(web3.currentProvider);
const Store = artifacts.require("Store");

contract("Store", function(accounts) {
  // A deployed instance of the Store contract, ready for testing.
  let store;

  const owner = accounts[0];
  const derivative = accounts[1];
  const erc20TokenOwner = accounts[2];

  const identifier = web3.utils.utf8ToHex("id");
  const arbitraryTokenAddr = web3.utils.randomHex(20);

  // TODO Add test final fee for test identifier

  beforeEach(async function() {
    store = await Store.deployed();
  });

  it("Compute fees basic check", async function() {
    // Set fee to 10%
    let newFee = { value: web3.utils.toWei("0.1", "ether") };
    await store.setFixedOracleFeePerSecond(newFee, { from: owner });

    let pfc = { value: web3.utils.toWei("2", "ether") };

    // Wait one second, then check fees are correct
    let fees = await store.computeRegularFee(100, 101, pfc, {});
    assert.equal(fees.regularFee.toString(), web3.utils.toWei("0.2", "ether"));
    assert.equal(fees.latePenalty.toString(), "0");

    // Wait 10 seconds, then check fees are correct
    fees = await store.computeRegularFee(100, 110, pfc, {});
    assert.equal(fees.regularFee.toString(), web3.utils.toWei("2", "ether"));
  });

  it("Compute fees at 20%", async function() {
    // Change fee to 20%
    let newFee = { value: web3.utils.toWei("0.2", "ether") };
    await store.setFixedOracleFeePerSecond(newFee, { from: owner });

    let pfc = { value: web3.utils.toWei("2", "ether") };

    // Run time tests again
    let fees = await store.computeRegularFee(100, 101, pfc, {});
    assert.equal(fees.regularFee.toString(), web3.utils.toWei("0.4", "ether"));

    fees = await store.computeRegularFee(100, 110, pfc, {});
    assert.equal(fees.regularFee.toString(), web3.utils.toWei("4", "ether"));
  });

  it("Check for illegal params", async function() {
    // Disallow endTime < startTime.
    assert(await didContractThrow(store.computeRegularFee(2, 1, 10)));

    // Disallow setting fees higher than 100%.
    let highFee = { value: web3.utils.toWei("1", "ether") };
    assert(await didContractThrow(store.setFixedOracleFeePerSecond(highFee, { from: owner })));

    // TODO Check that only permitted role can change the fee
  });

  it("Final fees", async function() {
    //Add final fee and confirm
    await store.setFinalFee(arbitraryTokenAddr, { value: web3.utils.toWei("5", "ether") }, { from: owner });
    const fee = await store.computeFinalFee(arbitraryTokenAddr);
    assert.equal(fee.value, web3.utils.toWei("5", "ether"));
  });

  it("Pay fees in Ether", async function() {
    // Verify the starting balance is 0.
    let balance = await web3.eth.getBalance(store.address);
    assert.equal(balance.toString(), "0");

    // Can't pay a fee of 0 ether.
    assert(await didContractThrow(store.payOracleFees({ from: derivative, value: web3.utils.toWei("0", "ether") })));

    // Send 1 ether to the contract and verify balance.
    await store.payOracleFees({ from: derivative, value: web3.utils.toWei("1", "ether") });
    balance = await web3.eth.getBalance(store.address);
    assert.equal(balance.toString(), web3.utils.toWei("1", "ether"));

    // Send a further 2 ether to the contract and verify balance.
    await store.payOracleFees({ from: derivative, value: web3.utils.toWei("2", "ether") });
    balance = await web3.eth.getBalance(store.address);
    assert.equal(balance.toString(), web3.utils.toWei("3", "ether"));

    // Only the owner can withdraw.
    assert(await didContractThrow(store.withdraw(web3.utils.toWei("0.5", "ether"), { from: derivative })));

    // Withdraw 0.5 ether and verify the  balance.
    await store.withdraw(web3.utils.toWei("0.5", "ether"));
    balance = await web3.eth.getBalance(store.address);
    assert.equal(balance.toString(), web3.utils.toWei("2.5", "ether"));

    // Can't withdraw more than the balance.
    assert(await didContractThrow(store.withdraw(web3.utils.toWei("10", "ether"))));

    // Withdraw remaining balance.
    await store.withdraw(web3.utils.toWei("2.5", "ether"));
    balance = await web3.eth.getBalance(store.address);
    assert.equal(balance.toString(), web3.utils.toWei("0", "ether"));
  });

  it("Pay fees in ERC20 token", async function() {
    const firstMarginToken = await ERC20Mintable.new({ from: erc20TokenOwner });
    const secondMarginToken = await ERC20Mintable.new({ from: erc20TokenOwner });

    // Mint 100 tokens of each to the contract and verify balances.
    await firstMarginToken.mint(derivative, web3.utils.toWei("100", "ether"), { from: erc20TokenOwner });
    let firstTokenBalanceInStore = await firstMarginToken.balanceOf(store.address);
    let firstTokenBalanceInDerivative = await firstMarginToken.balanceOf(derivative);
    assert.equal(firstTokenBalanceInStore, 0);
    assert.equal(firstTokenBalanceInDerivative, web3.utils.toWei("100", "ether"));

    await secondMarginToken.mint(derivative, web3.utils.toWei("100", "ether"), { from: erc20TokenOwner });
    let secondTokenBalanceInStore = await secondMarginToken.balanceOf(store.address);
    let secondTokenBalanceInDerivative = await secondMarginToken.balanceOf(derivative);
    assert.equal(secondTokenBalanceInStore, 0);
    assert.equal(secondTokenBalanceInDerivative, web3.utils.toWei("100", "ether"));

    // Pay 10 of the first margin token to the store and verify balances.
    await firstMarginToken.approve(store.address, web3.utils.toWei("10", "ether"), { from: derivative });
    await store.payOracleFeesErc20(firstMarginToken.address, { from: derivative });
    firstTokenBalanceInStore = await firstMarginToken.balanceOf(store.address);
    firstTokenBalanceInDerivative = await firstMarginToken.balanceOf(derivative);
    assert.equal(firstTokenBalanceInStore.toString(), web3.utils.toWei("10", "ether"));
    assert.equal(firstTokenBalanceInDerivative.toString(), web3.utils.toWei("90", "ether"));

    // Pay 20 of the second margin token to the store and verify balances.
    await secondMarginToken.approve(store.address, web3.utils.toWei("20", "ether"), { from: derivative });
    await store.payOracleFeesErc20(secondMarginToken.address, { from: derivative });
    secondTokenBalanceInStore = await secondMarginToken.balanceOf(store.address);
    secondTokenBalanceInDerivative = await secondMarginToken.balanceOf(derivative);
    assert.equal(secondTokenBalanceInStore.toString(), web3.utils.toWei("20", "ether"));
    assert.equal(secondTokenBalanceInDerivative.toString(), web3.utils.toWei("80", "ether"));

    // Withdraw 15 (out of 20) of the second margin token and verify balances.
    await store.withdrawErc20(secondMarginToken.address, web3.utils.toWei("15", "ether"), { from: owner });
    let secondTokenBalanceInOwner = await secondMarginToken.balanceOf(owner);
    secondTokenBalanceInStore = await secondMarginToken.balanceOf(store.address);
    assert.equal(secondTokenBalanceInOwner.toString(), web3.utils.toWei("15", "ether"));
    assert.equal(secondTokenBalanceInStore.toString(), web3.utils.toWei("5", "ether"));

    // Only owner can withdraw.
    assert(
      await didContractThrow(
        store.withdrawErc20(secondMarginToken.address, web3.utils.toWei("5", "ether"), { from: derivative })
      )
    );

    // Can't withdraw more than the balance.
    assert(
      await didContractThrow(
        store.withdrawErc20(secondMarginToken.address, web3.utils.toWei("100", "ether"), { from: owner })
      )
    );

    // Withdraw remaining amounts and verify balancse.
    await store.withdrawErc20(firstMarginToken.address, web3.utils.toWei("10", "ether"), { from: owner });
    await store.withdrawErc20(secondMarginToken.address, web3.utils.toWei("5", "ether"), { from: owner });

    let firstTokenBalanceInOwner = await firstMarginToken.balanceOf(owner);
    firstTokenBalanceInStore = await firstMarginToken.balanceOf(store.address);
    assert.equal(firstTokenBalanceInOwner.toString(), web3.utils.toWei("10", "ether"));
    assert.equal(firstTokenBalanceInStore.toString(), web3.utils.toWei("0", "ether"));

    secondTokenBalanceInOwner = await secondMarginToken.balanceOf(owner);
    secondTokenBalanceInStore = await secondMarginToken.balanceOf(store.address);
    assert.equal(secondTokenBalanceInOwner.toString(), web3.utils.toWei("20", "ether"));
    assert.equal(secondTokenBalanceInStore.toString(), web3.utils.toWei("0", "ether"));
  });
});
