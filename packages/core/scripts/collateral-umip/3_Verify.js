// This script verify that the upgrade was executed correctly.
// It can be run on mainnet after the upgrade is completed or on the local Ganache mainnet fork to validate the
// execution of the previous two scripts. This script does not need any wallets unlocked and does not make any on-chain
// state changes. It can be run as:
// yarn truffle exec ./scripts/collateral-umip/3_Verify.js --network mainnet-fork --collateral 0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2 --fee 0.1 --collateral 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 --fee 400

const assert = require("assert").strict;

const AddressWhitelist = artifacts.require("AddressWhitelist");
const Store = artifacts.require("Store");
const ERC20 = artifacts.require("ERC20");

const { parseUnits } = require("@ethersproject/units");
const _ = require("lodash");
const { getDecimals } = require("./utils");

const argv = require("minimist")(process.argv.slice(), { string: ["collateral", "fee"] });

async function runExport() {
  console.log("Running Upgrade Verifier🔥");

  if (!argv.collateral || !argv.fee) {
    throw "Must provide --fee and --collateral";
  }

  const collaterals = _.castArray(argv.collateral);
  const fees = _.castArray(argv.fee);
  const decimals = _.castArray(argv.decimals);

  const argObjects = _.zipWith(collaterals, fees, decimals, (collateral, fee, numDecimalsArg) => {
    return { collateral, fee, numDecimalsArg };
  });

  for (const { collateral, fee, numDecimalsArg } of argObjects) {
    const decimal = await getDecimals(collateral, numDecimalsArg, ERC20);

    const store = await Store.deployed();
    assert.equal((await store.computeFinalFee(collateral)).rawValue, parseUnits(fee, decimal).toString());

    const whitelist = await AddressWhitelist.deployed();
    assert(await whitelist.isOnWhitelist(collateral));
  }

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
