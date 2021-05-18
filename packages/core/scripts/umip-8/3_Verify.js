// This script verify that the upgrade was executed correctly.
// It can be run on mainnet after the upgrade is completed or on the local Ganache mainnet fork to validate the
// execution of the previous two scripts. This script does not need any wallets unlocked and does not make any on-chain
// state changes. It can be run as:
// truffle exec ./scripts/umip-3/3_Verify.js --network mainnet-fork

const assert = require("assert");

const Finder = artifacts.require("Finder");
const AddressWhitelist = artifacts.require("AddressWhitelist");
const Governor = artifacts.require("Governor");

const { interfaceName } = require("@uma/common");
const { PublicNetworks } = require("@uma/common");

async function runExport() {
  console.log("Running Upgrade Verifier🔥");

  const finder = await Finder.deployed();
  const governor = await Governor.deployed();

  const collateralWhitelistAddress = await finder.getImplementationAddress(
    web3.utils.utf8ToHex(interfaceName.CollateralWhitelist)
  );
  const collateralWhitelist = await AddressWhitelist.at(collateralWhitelistAddress);

  assert.equal(await collateralWhitelist.owner(), governor.address);

  const { daiAddress } = PublicNetworks[await web3.eth.net.getId()];
  assert.deepEqual(await collateralWhitelist.getWhitelist(), [daiAddress]);

  console.log("Upgrade Verified!");
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
