const Migrations = artifacts.require("Migrations");

const checkDeploymentValidity = async function(callback) {
  try {
    // Note: this script pulls the all contracts that are deployed as singletons and does a rough verification that
    // the deployed address points to a contract of the correct type. This will not catch minor bytecode mismatches.

    // Migrations
    const migrations = await Migrations.deployed();
    await migrations.lastCompletedMigration();

    console.log("Deployment looks good!");
  } catch (e) {
    // Forces the script to return a nonzero error code so failure can be detected in bash.
    callback(e);
    return;
  }

  callback();
};

module.exports = checkDeploymentValidity;
