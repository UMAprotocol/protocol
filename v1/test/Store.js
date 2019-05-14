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

  beforeEach(async function() {
    store = await Store.new();
  });

  it("Compute fees", async function() {
    //Set fee to 10%
   const result = await store.setFixedOracleFeePerSecond(web3.utils.toWei("0.1", "ether"));
   console.log("FEE: " + result);

    //Check event is emitted
    // truffleAssert.eventEmitted(result, "SetFixedOracleFeePerSecond", ev => {
    //   return ev.newOracleFee.toString() === web3.utils.toWei("0.1", "ether");
    // });

    // //Wait one second, then check fees are correct
    let fees = await store.computeRegularFee(100, 110, web3.utils.toWei("2", "ether"), identifier);
    assert.equal(fees.regularFee, web3.utils.toWei("0.2", "ether"));
    assert.equal(fees.latePenalty, "0")

    // //wait 10 seconds, then check fees are correct
    // fees = await store.computeRegularFee(100, 110, web3.utils.toWei("2", "ether"), identifier);
    // assert.equal(fees.toString(), web3.utils.toWei("2", "ether"));

    // //Change fee to 20%
    // await store.setFixedOracleFeePerSecond(web3.utils.toWei("0.2", "ether"), identifier);

    // //Run time tests again
    // fees = await store.computeRegularFee(100, 101, web3.utils.toWei("2", "ether"), identifier);
    // assert.equal(fees.toString(), web3.utils.toWei("0.4", "ether"));

    // fees = await store.computeRegularFee(100, 110, web3.utils.toWei("2", "ether"), identifier);
    // assert.equal(fees.toString(), web3.utils.toWei("0.2", "ether"));

    // // Disallow endTime < startTime.
    // assert(await didContractThrow(store.computeRegularFee(2, 1, 10, identifier)));

    //can't pay 0 fees

    //set up an expiring contract 
    
    //and have it compute a final fee

    //check that only permitted role can change the fee
    
    //const result = await store.computeRegularFee("0","1","10", {from:owner});
   // assert.equal(result.regularFee, 7);
    //assert.equal(result.latePenalty, "0");
  });

  //TODO tests for fees in Ether and ERC20
});