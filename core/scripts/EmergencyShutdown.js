const assert = require("assert");
const { interfaceName } = require("../utils/Constants.js");

const FinancialContractsAdmin = artifacts.require("FinancialContractsAdmin");
const Finder = artifacts.require("Finder");

const argv = require("minimist")(process.argv.slice(), { string: ["derivative"] });

async function run(account, derivative) {
  try {
    // Usage: `truffle exec scripts/EmergencyShutdown.js --derivative <derivative address> --keys <oracle key> --network <network>
    // Requires the contract to be live and for accounts[0] to be the owner of the oracle.
    const deployedFinder = await Finder.deployed();

    // Emergency shutdown the contract using the admin.
    const admin = await FinancialContractsAdmin.at(
      await deployedFinder.getImplementationAddress(web3.utils.utf8ToHex(interfaceName.FinancialContractsAdmin))
    );
    await admin.callEmergencyShutdown(derivative);

    console.log("Emergency shutdown complete");
  } catch (e) {
    console.log(e);
  }
}

async function runScript(callback) {
  const account = (await web3.eth.getAccounts())[0];
  await run(account, argv.derivative);
  callback();
}

// Attach this function to the exported function
// in order to allow the script to be executed through both truffle and a test runner.
runScript.run = run;
module.exports = runScript;
