// This script generates and submits an identifier-add upgrade transaction to the DVM. It can be run on a local ganache
// fork of the main net or can be run directly on the main net to execute the upgrade transactions.
// To run this on the localhost first fork main net into Ganache with the proposerWallet unlocked as follows:
// ganache-cli --fork https://mainnet.infura.io/v3/5f56f0a4c8844c96a430fbd3d7993e39 --unlock 0x2bAaA41d155ad8a4126184950B31F50A1513cE25 --unlock 0x7a3a1c2de64f20eb5e916f40d11b01c441b2a8dc --port 9545
// Then execute the script as: yarn truffle exec ./scripts/collateral-umip/1_Propose.js --network mainnet-fork --collateral 0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2 --fee 0.1 from core

const AddressWhitelist = artifacts.require("AddressWhitelist");
const Store = artifacts.require("Store");
const Governor = artifacts.require("Governor");
const ERC20 = artifacts.require("ERC20");

const { parseUnits } = require("@ethersproject/units");

const argv = require("minimist")(process.argv.slice(), { string: ["collateral", "fee", "decimals"] });

const proposerWallet = "0x2bAaA41d155ad8a4126184950B31F50A1513cE25";

async function getDecimals() {
  const collateral = await ERC20.at(argv.collateral);
  try {
    const decimals = (await collateral.decimals()).toString();
    return decimals;
  } catch (error) {
    if (!argv.decimals) {
      throw "Must provide --decimals if token has no decimals function.";
    }
    return argv.decimals;
  }
}

async function runExport() {
  console.log("Running Upgrade🔥");
  console.log("Connected to network id", await web3.eth.net.getId());

  if (!argv.collateral || !argv.fee) {
    throw "Must provide --fee and --collateral";
  }

  const decimals = await getDecimals();
  const convertedFeeAmount = parseUnits(argv.fee, decimals).toString();
  console.log(`Fee in token's decimals: ${convertedFeeAmount}`);

  // The proposal will first add a final fee for the currency.
  const store = await Store.deployed();
  const addFinalFeeToStoreTx = store.contract.methods
    .setFinalFee(argv.collateral, { rawValue: convertedFeeAmount })
    .encodeABI();
  console.log("addFinalFeeToStoreTx", addFinalFeeToStoreTx);

  // The proposal will then add the currency to the whitelist.
  const whitelist = await AddressWhitelist.deployed();
  const addCollateralToWhitelistTx = whitelist.contract.methods.addToWhitelist(argv.collateral).encodeABI();
  console.log("addCollateralToWhitelistTx", addCollateralToWhitelistTx);

  // Send the proposal
  const governor = await Governor.deployed();
  await governor.propose(
    [
      {
        to: store.address,
        value: 0,
        data: addFinalFeeToStoreTx
      },
      {
        to: whitelist.address,
        value: 0,
        data: addCollateralToWhitelistTx
      }
    ],
    { from: proposerWallet, gas: 2000000 }
  );

  console.log(`

Proposed collateral currency: ${argv.collateral}
Proposed final fee: ${argv.fee}

`);
}

const run = async function(callback) {
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
