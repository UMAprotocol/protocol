// This script generates and submits an add-member transaction to the DVM, which registers a new contractCreator. This can be used to register a new EMPCreator for example.
// It can be run on a local ganache fork of the main net or can be run directly on the main net to execute the upgrade transactions.
// To run this on the localhost first fork main net into Ganache with the proposerWallet unlocked as follows:
// ganache-cli --fork https://mainnet.infura.io/v3/5f56f0a4c8844c96a430fbd3d7993e39 --unlock 0x2bAaA41d155ad8a4126184950B31F50A1513cE25 --port 9545
// Then execute the script as: yarn truffle exec ./scripts/creator-umip/1_Propose.js --network mainnet-fork --creator 0x9A077D4fCf7B26a0514Baa4cff0B481e9c35CE87 from core

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
    { from: proposerWallet, gas: 2000000 }
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
