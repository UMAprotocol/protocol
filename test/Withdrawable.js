const { didContractThrow } = require("./utils/DidContractThrow.js");

const Withdrawable = artifacts.require("Withdrawable");
const CentralizedStore = artifacts.require("CentralizedStore");

// Pull in contracts from dependencies.
const ERC20MintableData = require("openzeppelin-solidity/build/contracts/ERC20Mintable.json");
const truffleContract = require("truffle-contract");
const ERC20Mintable = truffleContract(ERC20MintableData);
ERC20Mintable.setProvider(web3.currentProvider);

contract("Withdrawable", function(accounts) {
  // A deployed instance of the CentralizedOracle contract, ready for testing.
  let withdrawable;
  let token;

  const owner = accounts[0];
  const rando = accounts[1];

  before(async function() {
    // Add creator and register owner as an approved derivative.
    token = await ERC20Mintable.new();
    await token.mint(rando, web3.utils.toWei("100", "ether"));
  });

  it("Withdraw ERC20", async function() {
    const withdrawable = await Withdrawable.new();

    // Transfer tokens to the withdrawable address without notifying the contract.
    await token.transfer(withdrawable.address, web3.utils.toWei("1.5", "ether"), { from: rando });

    // Attempted to withdraw more than the current balance.
    assert(await didContractThrow(withdrawable.withdrawErc20(token.address, web3.utils.toWei("2", "ether"))));


    // Should only withdraw 0.5 tokens.
    let startingBalance = await token.balanceOf(owner);
    await withdrawable.withdrawErc20(token.address, web3.utils.toWei("0.5", "ether"));
    let endingBalance = await token.balanceOf(owner);
    assert.equal(startingBalance.add(web3.utils.toBN(web3.utils.toWei("0.5", "ether"))).toString(), endingBalance.toString());

    // Withdraw remaining balance.
    startingBalance = await token.balanceOf(owner);
    await withdrawable.withdrawErc20(token.address, web3.utils.toWei("1", "ether"));
    endingBalance = await token.balanceOf(owner);
    assert.equal(startingBalance.add(web3.utils.toBN(web3.utils.toWei("1", "ether"))).toString(), endingBalance.toString());
  });

  it("Withdraw ETH", async function() {
    // Note: we must use a contract that can accept payments to test ETH withdrawal.
    const store = await CentralizedStore.new();

    // Add 1.5 ETH to the contract.
    await store.payOracleFees({ from: rando, value: web3.utils.toWei("1.5", "ether") });
    
    // To ensure we use the withdrawable interface to withdraw, we "cast" the store to Withdrawable.
    const withdrawable = await Withdrawable.at(store.address);

    // Should only withdraw 0.5 tokens.
    let startingBalance = web3.utils.toBN(await web3.eth.getBalance(address));
    await withdrawable.withdraw(web3.utils.toWei("0.5", "ether"));
    let endingBalance = web3.utils.toBN(await web3.eth.getBalance(address));
    assert.equal(startingBalance.add(web3.utils.toBN(web3.utils.toWei("0.5", "ether"))).toString(), endingBalance.toString());

    // Withdraw remaining balance.
    startingBalance = web3.utils.toBN(await web3.eth.getBalance(address));
    await withdrawable.withdraw(web3.utils.toWei("1", "ether"));
    endingBalance = web3.utils.toBN(await web3.eth.getBalance(address));
    assert.equal(startingBalance.add(web3.utils.toBN(web3.utils.toWei("1", "ether"))).toString(), endingBalance.toString());
  });
});
