const { didContractThrow } = require("../../common/SolidityTestUtils.js");

const ERC20MintableData = require("openzeppelin-solidity/build/contracts/ERC20Mintable.json");
const truffleAssert = require("truffle-assertions");
const truffleContract = require("truffle-contract");
const ERC20Mintable = truffleContract(ERC20MintableData);
ERC20Mintable.setProvider(web3.currentProvider);
const Store = artifacts.require("Store");

contract("Store", function(accounts) {
  // A deployed instance of the CentralizedStore contract, ready for testing.
  let store;

  const owner = accounts[0];
  const derivative = accounts[1];
  const erc20TokenOwner = accounts[2];

  beforeEach(async function() {
    store = await Store.new();
  });

  it("Compute fees", async function() {
    //set fee

    //check event is emitted

    //wait one second, then check fees are correct

    //wait 10 seconds, then check fees are correct

    //change fee

    //run time tests again

    //check that illegal times don't happen?

    //can't pay 0 fees

    //set up an expiring contract 
    
    //and have it compute a final fee

    //check that only permitted role can change the fee
    
    const result = await store.computeRegularFee("0","1","10", {from:owner});
    assert.equal(result.regularFee, 7);
    assert.equal(result.latePenalty, "0");
  });

  //TODO tests for fees in Ether and ERC20
});