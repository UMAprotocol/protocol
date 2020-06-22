// This script generates and submits an identifier-add upgrade transaction to the DVM. It can be run on a local ganache
// fork of the main net or can be run directly on the main net to execute the upgrade transactions.
// To run this on the localhost first fork main net into Ganache with the proposerWallet unlocked as follows:
// ganache-cli --fork https://mainnet.infura.io/v3/d70106f59aef456c9e5bfbb0c2cc7164 --unlock 0x2bAaA41d155ad8a4126184950B31F50A1513cE25
// Then execute the script as: truffle exec ./scripts/umip-2/1_Propose.js --network mainnet-fork from core

const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const Governor = artifacts.require("Governor");

const { RegistryRolesEnum } = require("../../../common/Enums.js");
const argv = require("minimist")(process.argv.slice(), { string: ["identifier"] });

const tdr = require("truffle-deploy-registry");

const proposerWallet = "0x2bAaA41d155ad8a4126184950B31F50A1513cE25";
const zeroAddress = "0x0000000000000000000000000000000000000000";

async function runExport() {
  console.log("Running Upgrade🔥");
  console.log("Connected to network id", await web3.eth.net.getId());

  const identifierWhitelist = await IdentifierWhitelist.deployed();
  const governor = await Governor.deployed();

  // After it's given ownership, the upgrade transaction needs to be executed.
  const identifierBytes = web3.utils.utf8ToHex(argv.identifier);
  const addIdentifierTx = identifierWhitelist.contract.methods.addSupportedIdentifier(identifierBytes).encodeABI();

  console.log("addIdentifierTx", addIdentifierTx);

  await governor.propose(
    [
      {
        to: identifierWhitelist.address,
        value: 0,
        data: addIdentifierTx
      }
    ],
    { from: proposerWallet }
  );

  console.log(`

Newly Proposed DVM Identifier: 

${argv.identifier} (UTF8)
${identifierBytes} (HEX)

`);
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
