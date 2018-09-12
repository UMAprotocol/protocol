var VoteCoin = artifacts.require("VoteCoin");

module.exports = function(deployer, network, accounts) {
    // Send 0.5 ether with our account so it can update price repeatedly
    deployer.deploy(VoteCoin, {from: accounts[0], value: 500000000000000000});
};

