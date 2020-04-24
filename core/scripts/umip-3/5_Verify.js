const assert = require("assert").strict;

const Finder = artifacts.require("Finder");
const Registry = artifacts.require("Registry");
const Voting = artifacts.require("Voting");
const Store = artifacts.require("Store");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const Governor = artifacts.require("Governor");
const FinancialContractsAdmin = artifacts.require("FinancialContractsAdmin");

const Govflat = artifacts.require("govflat");

const { interfaceName } = require("../../utils/Constants.js");

const foundationWallet = "0x7a3A1c2De64f20EB5e916F40D11B01C441b2A8Dc";

const ownerRole = "0";

// New addresses of ecosystem components after porting from `Propose.js`
const upgradeAddresses = {
  Voting: "0x3B99859bE43d543960803C09A0247106e82E74ee",
  Governor: "0xD74a9900597e764A62Bbc6EeA9364DF4272BF5B4"
};

async function runExport() {
  let newGovernor = await Governor.new();
  console.log("deployed!", newGovernor.address);

//   console.log("Running UMIP-3 Upgrade playground🔥");

//   const onChainByteCode = await web3.eth.getCode(upgradeAddresses.Voting);
//   const deployedBytecode = Voting.toJSON().deployedBytecode;

//   console.log("match deployedBytecode", onChainByteCode == deployedBytecode);

//   const onChainByteCode2 = await web3.eth.getCode(upgradeAddresses.Governor);
//   const deployedBytecode2 = Governor.toJSON().deployedBytecode;

//   console.log("match deployedBytecode governor", onChainByteCode2 == deployedBytecode2);
// }

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
