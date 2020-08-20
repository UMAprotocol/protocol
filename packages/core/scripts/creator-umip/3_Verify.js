// This script verify that the upgrade was executed correctly.
// It can be run on mainnet after the upgrade is completed or on the local Ganache mainnet fork to validate the
// execution of the previous two scripts. This script does not need any wallets unlocked and does not make any on-chain
// state changes. It can be run as:
// truffle exec ./scripts/creator-umip/3_Verify.js --network mainnet-fork --creator 0x0139d00c416e9F40465a95481F4E36422a0A5fcc

const assert = require("assert");

const Registry = artifacts.require("Registry");

const argv = require("minimist")(process.argv.slice(), { string: ["creator"] });
const { RegistryRolesEnum } = require("@umaprotocol/common");

async function runExport() {
  console.log("Running Upgrade Verifier🔥");

  const registry = await Registry.deployed();

  assert(await registry.holdsRole(RegistryRolesEnum.CONTRACT_CREATOR, argv.creator));
  console.log("Upgrade Verified!");
}

run = async function(callback) {
  try {
    await runExport();
  } catch (err) {
    callback(err);
    return;
  }
  callback();
};

// Attach this function to the exported function in order to allow the script to be executed through both truffle and a test runner.
run.runExport = runExport;
module.exports = run;
