const Finder = artifacts.require("Finder");
const Migrations = artifacts.require("Migrations");
const Registry = artifacts.require("Registry");
const { interfaceName } = require("@uma/common");

const checkDeploymentValidity = async function (callback) {
  try {
    // Note: this script pulls the all contracts that are deployed as singletons and does a rough verification that
    // the deployed address points to a contract of the correct type. This will not catch minor bytecode mismatches.

    // Migrations
    const migrations = await Migrations.deployed();
    await migrations.last_completed_migration();

    // Finder
    const finder = await Finder.deployed();
    const registryImplementationAddress = await finder.getImplementationAddress(
      web3.utils.utf8ToHex(interfaceName.Registry)
    );
    if (registryImplementationAddress != Registry.address) {
      throw "Incorrect implementation address for Registry";
    }

    console.log("Deployment looks good!");
  } catch (e) {
    // Forces the script to return a nonzero error code so failure can be detected in bash.
    callback(e);
    return;
  }

  callback();
};

module.exports = checkDeploymentValidity;
