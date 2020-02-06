const argv = require("minimist")(process.argv.slice());
const Migrations = artifacts.require("./Migrations.sol");
const { getKeysForNetwork, deploy, addToTdr } = require("../../common/MigrationUtils.js");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);
  await deploy(deployer, network, Migrations, { from: keys.deployer });
};
