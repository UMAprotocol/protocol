// This script verify that the UMPIP-3 upgrade was executed correctly by checking deployed bytecodes,
// assigned ownerships and roles. It can be run on the main net after the upgrade is completed
// or on the local Ganache mainnet fork to validate the execution of the previous  two scripts.
// This script does not need any wallets unlocked and does not make any on-chain state changes. It can be run as:
// truffle exec ./scripts/umip-3/3_Verify.js --network mainnet-fork

const assert = require("assert").strict;

const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");

async function runExport() {
  console.log("Running UMIP-2 Upgrade Verifier🔥");

  const identifierWhitelist = await IdentifierWhitelist.deployed();

  assert.equal(await identifierWhitelist.isIdentifierSupported(web3.utils.utf8ToHex("ETH/BTC")), true);

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
