const Migrations = artifacts.require("./Migrations.sol");
const { getKeysForNetwork, deployAndGet, addToTdr } = require("../../common/MigrationUtils.js");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);
  const migrations = await deployAndGet(deployer, Migrations, { from: keys.deployer });
  await addToTdr(migrations, network);
};
