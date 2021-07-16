// This script generates and submits a transaction that registers a new price requester for the DVM. It can be
// run on a local ganache fork of the mainnet or can be run directly on the mainnet to execute the upgrade
// transactions. To run this on the localhost first fork mainnet into Ganache with the proposerWallet unlocked as follows from core:
// ganache-cli --fork https://mainnet.infura.io/v3/5f56f0a4c8844c96a430fbd3d7993e39 --unlock 0x2bAaA41d155ad8a4126184950B31F50A1513cE25 --unlock 0x7a3a1c2de64f20eb5e916f40d11b01c441b2a8dc --port 9545
// Then execute the script from core:
// yarn truffle exec ./scripts/register-contract-umip/1_Propose.js --network mainnet-fork --contract 0xCONTRACT_ADDRESS

// Use the same ABI's as deployed contracts:
const { getTruffleContract } = require("../../dist/index");
const Governor = getTruffleContract("Governor", web3, "1.1.0");
const Registry = getTruffleContract("Registry", web3, "1.1.0");

const { RegistryRolesEnum } = require("@uma/common");

const argv = require("minimist")(process.argv.slice(), { string: ["contract"] });

const proposerWallet = "0x2bAaA41d155ad8a4126184950B31F50A1513cE25";

async function runExport() {
  console.log("Running Upgrade🔥");
  console.log("Connected to network id", await web3.eth.net.getId());

  const contractAddress = argv.contract;
  if (!contractAddress) {
    throw new Error("Must specify --contract");
  }
  console.log(`Registering contract at ${contractAddress}`);

  const governor = await Governor.deployed();

  // The proposal will add this new contract creator to the Registry.
  const registry = await Registry.deployed();

  // 1. Temporarily add the Governor as a contract creator.
  const addGovernorToRegistryTx = registry.contract.methods
    .addMember(RegistryRolesEnum.CONTRACT_CREATOR, governor.address)
    .encodeABI();

  console.log("addGovernorToRegistryTx", addGovernorToRegistryTx);

  // 2. Register the contract as a verified contract.
  const registerContractTx = registry.contract.methods.registerContract([], contractAddress).encodeABI();

  console.log("registerContractTx", registerContractTx);

  // 3. Remove the Governor from being a contract creator.
  const removeGovernorFromRegistryTx = registry.contract.methods
    .removeMember(RegistryRolesEnum.CONTRACT_CREATOR, governor.address)
    .encodeABI();

  console.log("removeGovernorFromRegistryTx", removeGovernorFromRegistryTx);

  console.log("Proposing...");

  // Send the proposal
  await governor.propose(
    [
      { to: registry.address, value: 0, data: addGovernorToRegistryTx },
      { to: registry.address, value: 0, data: registerContractTx },
      { to: registry.address, value: 0, data: removeGovernorFromRegistryTx },
    ],
    { from: proposerWallet, gas: 2000000 }
  );

  console.log("Proposal Done.");
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
