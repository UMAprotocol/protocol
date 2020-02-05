const argv = require("minimist")(process.argv.slice());
const Migrations = artifacts.require("./Migrations.sol");
const { getKeysForNetwork, deploy, addToTdr } = require("../../common/MigrationUtils.js");

module.exports = async function(deployer, network, accounts) {
  if (argv["skip-migration"] === "t" || argv["s"]) {
    console.log("Running tests with skipped migrations...");
    return;
  }
  const keys = getKeysForNetwork(network, accounts);
  await deploy(deployer, network, Migrations, { from: keys.deployer });
};
