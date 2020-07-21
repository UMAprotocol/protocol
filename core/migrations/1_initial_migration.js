const Migrations = artifacts.require("./Migrations.sol");
const { getKeysForNetwork, deploy, addToTdr } = require("@umaprotocol/common");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);
  await deploy(deployer, network, Migrations, { from: keys.deployer });
};
