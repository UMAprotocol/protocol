// This script verify that the upgrade was executed correctly.
// It can be run on mainnet after the upgrade is completed or on the local Ganache mainnet fork to validate the
// execution of the previous two scripts. This script does not need any wallets unlocked and does not make any on-chain
// state changes. It can be run as:
// yarn truffle exec ./scripts/optimistic-oracle-umip/3_Verify.js --network mainnet-fork --deployedAddress 0xOPTIMISTIC_ORACLE_ADDRESS

const assert = require("assert").strict;

// Use the same ABI's as deployed contracts:
const { getTruffleContract } = require("../../dist/index");
const Governor = getTruffleContract("Governor", web3, "1.1.0");
const Finder = getTruffleContract("Finder", web3, "1.1.0");
const Registry = getTruffleContract("Registry", web3, "1.1.0");

const { RegistryRolesEnum, interfaceName } = require("@uma/common");

const argv = require("minimist")(process.argv.slice(), { string: ["deployedAddress"] });

async function runExport() {
  console.log("Running Upgrade Verifier🔥");

  if (!argv.deployedAddress) {
    throw new Error("Must specify --deployedAddress");
  }

  const registry = await Registry.deployed();
  const governor = await Governor.deployed();
  const finder = await Finder.deployed();

  console.log("Verifying that Governor doesn't hold the creator role...");
  assert(!(await registry.holdsRole(RegistryRolesEnum.CONTRACT_CREATOR, governor.address)));
  console.log("Verified!");

  console.log("Verifying that the OptimisticOracle is registered with the Registry...");
  assert(await registry.isContractRegistered(argv.deployedAddress));
  console.log("Verified!");

  console.log("Verifying that the OptimisticOracle is registered with the Finder...");
  assert.equal(
    (await finder.getImplementationAddress(web3.utils.utf8ToHex(interfaceName.OptimisticOracle))).toLowerCase(),
    argv.deployedAddress.toLowerCase()
  );
  console.log("Verified!");

  console.log("Upgrade Verified!");
}

const run = async function (callback) {
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
