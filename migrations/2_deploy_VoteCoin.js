var OracleMock = artifacts.require("OracleMock");
var Registry = artifacts.require("Registry");

module.exports = function(deployer, network, accounts) {
    // Send 0.5 ether with our account so it can update price repeatedly
    deployer.deploy(OracleMock, {from: accounts[0], value: 0});
    deployer.deploy(Registry, {from: accounts[0], value: 0});
};

