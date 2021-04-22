// This script verify that the upgrade was executed correctly.
// It can be run on mainnet after the upgrade is completed or on the local Ganache mainnet fork to validate the
// execution of the previous two scripts. This script does not need any wallets unlocked and does not make any on-chain
// state changes. It can be run as:
// yarn truffle exec ./scripts/identifier-umip/3_Verify.js --network mainnet-fork --identifier USDETH --identifier ETHBTC

const assert = require("assert").strict;

// Use the same ABI's as deployed contracts:
const { getTruffleContract } = require("../../index");
const IdentifierWhitelist = getTruffleContract("IdentifierWhitelist", web3, "1.1.0");

const argv = require("minimist")(process.argv.slice(), { string: ["identifier"] });

async function runExport() {
  console.log("Running Upgrade Verifier🔥");

  if (!argv.identifier) {
    throw new Error("Must specify --identifier");
  }

  // argv.identifier may be an array or a single string (if only one is desired).
  // In either case, `identifiers` should be an array.
  let identifiers;
  if (Array.isArray(argv.identifier)) {
    identifiers = argv.identifier;
  } else {
    identifiers = [argv.identifier];
  }

  console.log("Testing identifiers:", identifiers);
  const identifierWhitelist = await IdentifierWhitelist.deployed();

  for (const identifier of identifiers) {
    assert.equal(await identifierWhitelist.isIdentifierSupported(web3.utils.utf8ToHex(identifier)), true);
    console.log(identifier, "verified.");
  }

  console.log("Upgrade Verified!");
}

const run = async function(callback) {
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
