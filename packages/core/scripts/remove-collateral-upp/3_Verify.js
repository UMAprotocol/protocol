// This script verify that the collateral was removed correctly.
// It can be run on mainnet after the upgrade is completed or on the local Ganache mainnet fork to validate the
// execution of the previous two scripts. This script does not need any wallets unlocked and does not make any on-chain
// state changes. It can be run from core as:
// yarn truffle exec ./scripts/remove-collateral-upp/3_Verify.js --network mainnet-fork --collateral 0x84810bcf08744d5862b8181f12d17bfd57d3b078

const assert = require("assert").strict;

const AddressWhitelist = artifacts.require("AddressWhitelist");

const _ = require("lodash");

const argv = require("minimist")(process.argv.slice(), { string: ["collateral"] });

async function runExport() {
  console.log("Running Upgrade Verifier🔥");

  if (!argv.collateral) {
    throw "Must provide --collateral";
  }

  const collaterals = _.castArray(argv.collateral);

  const argObjects = _.zipWith(collaterals, (collateral) => {
    return { collateral };
  });

  for (const { collateral } of argObjects) {
    const whitelist = await AddressWhitelist.deployed();
    assert(!(await whitelist.isOnWhitelist(collateral)));
    console.log("Removed collateral:", collateral);
  }

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
