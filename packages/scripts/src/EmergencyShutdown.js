const { interfaceName } = require("@uma/common");

const argv = require("minimist")(process.argv.slice(), { string: ["derivative"] });

async function run(account, derivative, finder, adminAbi) {
  try {
    // Usage: `truffle exec scripts/EmergencyShutdown.js --derivative <derivative address> --keys <oracle key> --network <network>
    // Requires the contract to be live and for accounts[0] to be the owner of the oracle.

    // Emergency shutdown the contract using the admin.
    const adminAddress = await finder.methods
      .getImplementationAddress(web3.utils.utf8ToHex(interfaceName.FinancialContractsAdmin))
      .call();

    const admin = new web3.eth.Contract(adminAbi, adminAddress);
    await admin.methods.callEmergencyShutdown(derivative).send({ from: account });

    console.log("Emergency shutdown complete");
  } catch (e) {
    console.log(e);
  }
}

async function runScript(callback) {
  const account = (await web3.eth.getAccounts())[0];
  const adminAbi = artifacts.require("FinancialContractsAdmin").abi;
  const finder = await artifacts.require("Finder").deployed();
  await run(account, argv.derivative, finder, adminAbi);
  callback();
}

// Attach this function to the exported function
// in order to allow the script to be executed through both truffle and a test runner.
runScript.run = run;
module.exports = runScript;
