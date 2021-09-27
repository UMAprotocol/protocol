#!/usr/bin/env node

// Usage: `HARDHAT_NETWORK=kovan MNEMONIC="YOUR_MNEMONIC" src/EmergencyShutdown.js --derivative <derivative address>
// Requires the contract to be live and for accounts[0] to be the owner of the oracle.

const { web3, getContract } = require("hardhat");
const { interfaceName } = require("@uma/common");

const argv = require("minimist")(process.argv.slice(), { string: ["derivative"] });

async function run(account, derivative, finder, adminAbi) {
  // Emergency shutdown the contract using the admin.
  const adminAddress = await finder.methods
    .getImplementationAddress(web3.utils.utf8ToHex(interfaceName.FinancialContractsAdmin))
    .call();

  const admin = new web3.eth.Contract(adminAbi, adminAddress);
  await admin.methods.callEmergencyShutdown(derivative).send({ from: account });

  console.log("Emergency shutdown complete");
}

async function main() {
  const account = (await web3.eth.getAccounts())[0];
  const adminAbi = getContract("FinancialContractsAdmin").abi;
  const finder = await getContract("Finder").deployed();
  await run(account, argv.derivative, finder, adminAbi);
}

if (require.main === module) {
  main().then(
    () => {
      process.exit(0);
    },
    (error) => {
      console.error(error.stack);
      process.exit(1);
    }
  );
} else {
  module.exports = { run };
}
