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

  //add test final fee for test identifier

  beforeEach(async function() {
    store = await Store.new();
  });

  it("Compute fees", async function() {
    //Set fee to 10%
    let txReciept = await store.setFixedOracleFeePerSecond(web3.utils.toWei("0.1", "ether"));

    //Fixed Point wrappers
    let pfc = { value: web3.utils.toWei("2", "ether") };

    //Wait one second, then check fees are correct
    let fees = await store.computeRegularFee(100, 101, pfc, identifier);
    store.computeRegularFee(100, 101, pfc, identifier);
    assert.equal(fees.regularFee.toString(), web3.utils.toWei("0.2", "ether"));
    assert.equal(fees.latePenalty.toString(), "0");

    //wait 10 seconds, then check fees are correct
    fees = await store.computeRegularFee(100, 110, pfc, identifier);
    assert.equal(fees.regularFee.toString(), web3.utils.toWei("2", "ether"));

    //Change fee to 20%
    await store.setFixedOracleFeePerSecond(web3.utils.toWei("0.2", "ether"));

    //Run time tests again
    fees = await store.computeRegularFee(100, 101, pfc, identifier);
    assert.equal(fees.regularFee.toString(), web3.utils.toWei("0.4", "ether"));

    fees = await store.computeRegularFee(100, 110, pfc, identifier);
    assert.equal(fees.regularFee.toString(), web3.utils.toWei("4", "ether"));

    // Disallow endTime < startTime.
    assert(await didContractThrow(store.computeRegularFee(2, 1, 10, identifier)));

    // Disallow setting fees higher than 100%.
    assert(await didContractThrow(store.setFixedOracleFeePerSecond(web3.utils.toWei("1", "ether"))));

    //TODO Check that only permitted role can change the fee
  });

  //TODO tests for fees in Ether and ERC20
});
