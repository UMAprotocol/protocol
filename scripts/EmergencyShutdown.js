const assert = require("assert");
const CentralizedOracle = artifacts.require("CentralizedOracle");

const argv = require("minimist")(process.argv.slice(), { string: ["derivative"] });

async function run(account, derivative) {
  try {
    // Usage: `truffle exec scripts/EmergencyShutdown.js --derivative <derivative address> --keys <oracle key> --network <network>
    // Requires the contract to be live and for accounts[0] to be the owner of the oracle.
    oracle = await CentralizedOracle.deployed();

    assert.strictEqual(await oracle.owner(), account, "Account must be the owner of the oracle");

    await oracle.callEmergencyShutdown(derivative);
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
