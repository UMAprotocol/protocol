var Derivative = artifacts.require("Derivative");
var Registry = artifacts.require("Registry");
var Oracle = artifacts.require("VoteTokenMock");

contract("Derivative", function(accounts) {
  var derivativeContract;
  var deployedRegistry;
  var deployedOracle;

  beforeEach(done => {
    Registry.deployed()
      .then(function(instance) {
        deployedRegistry = instance;
        return Oracle.deployed();
      })
      .then(function(instance) {
        deployedOracle = instance;
        var date = new Date();
        date.setMonth(date.getMonth() + 3);
        return deployedRegistry.createDerivative(
          accounts[1],
          deployedOracle.address,
          web3.toWei("0.05", "ether"),
          web3.toWei("0.1", "ether"),
          (date.valueOf() / 1000).toString(),
          "ETH/USD",
          web3.toWei("1", "ether"),
          { from: accounts[0], value: web3.toWei("1", "ether") }
        );
      })
      .then(function(response) {
        return deployedRegistry.getNumRegisteredContractsBySender.call({ from: accounts[0] });
      })
      .then(function(response) {
        return deployedRegistry.getRegisteredContractBySender.call(response.sub(1).toString(), { from: accounts[0] });
      })
      .then(function(response) {
        derivativeContract = Derivative.at(response.toString());
        done();
      });
  });

  it("Should have deposit balance.", function() {
    // Note: the originator of the contract is, by definition, the taker.
    return derivativeContract.taker({ from: accounts[0] }).then(function(response) {
      assert.equal(response[0], accounts[0]);
      assert.equal(response[1].toString(), web3.toWei("1", "ether"));
    });
  });
});
