// This script generates and submits an identifier-add upgrade transaction to the DVM. It can be run on a local ganache
// fork of the main net or can be run directly on the main net to execute the upgrade transactions.
// To run this on the localhost first fork main net into Ganache with the proposerWallet unlocked as follows:
// ganache-cli --fork https://mainnet.infura.io/v3/d70106f59aef456c9e5bfbb0c2cc7164 --unlock 0x2bAaA41d155ad8a4126184950B31F50A1513cE25
// Then execute the script as: truffle exec ./scripts/creator-umip/1_Propose.js --network mainnet-fork --creator 0x0139d00c416e9F40465a95481F4E36422a0A5fcc from core

const Registry = artifacts.require("Registry");
const Governor = artifacts.require("Governor");

const argv = require("minimist")(process.argv.slice(), { string: ["creator"] });
const { RegistryRolesEnum } = require("@uma/common");

const proposerWallet = "0x2bAaA41d155ad8a4126184950B31F50A1513cE25";

async function runExport() {
  console.log("Running Upgrade🔥");
  console.log("Connected to network id", await web3.eth.net.getId());

  // The proposal will add this new contract creator to the Registry.
  const registry = await Registry.deployed();
  const addCreatorToRegistryTx = registry.contract.methods
    .addMember(RegistryRolesEnum.CONTRACT_CREATOR, argv.creator)
    .encodeABI();

  console.log("addCreatorToRegistryTx", addCreatorToRegistryTx);

  // Send the proposal
  const governor = await Governor.deployed();
  await governor.propose(
    [
      {
        to: registry.address,
        value: 0,
        data: addCreatorToRegistryTx
      }
    ],
    { from: proposerWallet }
  );

  console.log(`

Newly Added Contract Creator: ${argv.creator}

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
