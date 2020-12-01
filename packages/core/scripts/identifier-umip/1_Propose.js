// Before starting Mainnet fork Ganache instance, run:
// - git checkout 1ba5c380d8795bec41fb013956f9a2a2b1a29dc8
// - cd packages/core && yarn truffle compile
// (December 1, 2020) !!Note: The Voting ABI changed on this commit: https://github.com/UMAprotocol/protocol/commit/551ab99fa5d008eddcaade1db0beda72372a3067
// therefore, assuming that you are running this script from `master`, then it is neccessary to check out an older
// Voting ABI in order to run these scripts. Unlike unit tests, these scripts interact on a Mainnet fork network
// with a deployed Voting contract. The Voting contract was deployed with an ABI that is now different from that on `master`.

// This script generates and submits an identifier-add upgrade transaction to the DVM. It can be run on a local ganache
// fork of the main net or can be run directly on the main net to execute the upgrade transactions.
// To run this on the localhost first fork main net into Ganache with the proposerWallet unlocked as follows:
// ganache-cli --fork https://mainnet.infura.io/v3/d70106f59aef456c9e5bfbb0c2cc7164 --unlock 0x2bAaA41d155ad8a4126184950B31F50A1513cE25
// Then execute the script as: truffle exec ./scripts/identifier-umip/1_Propose.js --network mainnet-fork --identifier USDETH --identifier ETHBTC from core
const Governor = artifacts.require("Governor");

const { getAbi, getAddress } = require("../../index");
const argv = require("minimist")(process.argv.slice(), { string: ["identifier"] });

const proposerWallet = "0x2bAaA41d155ad8a4126184950B31F50A1513cE25";

async function runExport() {
  console.log("Running Upgrade🔥");
  console.log("Connected to network id", await web3.eth.net.getId());

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

  const identifierWhitelist = new web3.eth.Contract(
    getAbi("IdentifierWhitelist", "1.1.0"),
    getAddress("IdentifierWhitelist", "1", "1.1.0")
  );
  const governor = await Governor.deployed();

  // Generate the list of transactions from the list of identifiers.
  const transactions = identifiers.map(identifier => {
    const identifierBytes = web3.utils.utf8ToHex(identifier);
    const addIdentifierTx = identifierWhitelist.methods.addSupportedIdentifier(identifierBytes).encodeABI();
    console.log("addIdentifierTx", addIdentifierTx);
    return {
      to: identifierWhitelist.options.address,
      value: 0,
      data: addIdentifierTx
    };
  });

  // TODO: Calling this via the web3.eth.Contract method fails, possibly because `transactions` array is in an
  // unparseable format for governor.methods.propose() to read.
  await governor.propose(transactions, { from: proposerWallet });

  const identifierTable = identifiers.map(identifier => {
    return {
      identifier,
      hex: web3.utils.utf8ToHex(identifier)
    };
  });

  console.log(`
  Identifiers Proposed`);
  console.table(identifierTable);
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
