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

  // TODO Add test final fee for test identifier

  beforeEach(async function() {
    store = await Store.new();
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

  // TODO tests for fees in Ether and ERC20
});
