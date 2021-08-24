// This script generates and submits an identifier-add upgrade transaction to the DVM. It can be run on a local ganache
// fork of the mainnet or can be run directly on the mainnet to execute the upgrade transactions.
// To run this on the localhost first fork mainnet into Ganache with the proposerWallet unlocked as follows:
// ganache-cli --fork https://mainnet.infura.io/v3/d70106f59aef456c9e5bfbb0c2cc7164 --unlock 0x2bAaA41d155ad8a4126184950B31F50A1513cE25
// Then execute the script as: truffle exec ./scripts/umip-8/1_Propose.js --network mainnet-fork from core

const AddressWhitelist = artifacts.require("AddressWhitelist");
const Governor = artifacts.require("Governor");
const Finder = artifacts.require("Finder");

const { PublicNetworks } = require("@uma/common");
const { interfaceName } = require("@uma/common");

const proposerWallet = "0x2bAaA41d155ad8a4126184950B31F50A1513cE25";

async function runExport() {
  console.log("Running Upgrade🔥");
  const networkId = await web3.eth.net.getId();
  console.log("Connected to network id", networkId);

  // Create collateral whitelist and add DAI to it.
  const collateralWhitelist = await AddressWhitelist.new();
  const { daiAddress } = PublicNetworks[networkId];
  await collateralWhitelist.addToWhitelist(daiAddress);

  // Make the Governor the owner of the collateral whitelist.
  const governor = await Governor.deployed();
  await collateralWhitelist.transferOwnership(governor.address);

  // The proposal will add this new whitelist to the Finder.
  const finder = await Finder.deployed();
  const addWhitelistToFinderTx = finder.contract.methods
    .changeImplementationAddress(web3.utils.utf8ToHex(interfaceName.CollateralWhitelist), collateralWhitelist.address)
    .encodeABI();

  console.log("addWhitelistToFinderTx", addWhitelistToFinderTx);

  // Send the proposal
  await governor.propose([{ to: finder.address, value: 0, data: addWhitelistToFinderTx }], { from: proposerWallet });

  console.log(`

Newly Proposed Collateral Whitelist contract: ${collateralWhitelist.address}

`);
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
