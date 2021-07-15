// This script verify that the upgrade was executed correctly.
// It can be run on mainnet after the upgrade is completed or on the local Ganache mainnet fork to validate the
// execution of the previous two scripts. This script does not need any wallets unlocked and does not make any on-chain
// state changes. It can be run as:
// yarn truffle exec ./scripts/collateral-umip/3_Verify.js --network mainnet-fork --collateral 0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2 --fee 0.1 --collateral 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 --fee 400

const assert = require("assert").strict;

const AddressWhitelist = artifacts.require("AddressWhitelist");
const Store = artifacts.require("Store");
const ERC20 = artifacts.require("ERC20");
const GovernorRootTunnel = artifacts.require("GovernorRootTunnel");

const POLYGON_ADDRESSES = require("../../networks/137.json");
const getContractAddressByName = (contractName) => {
  return POLYGON_ADDRESSES.find((x) => x.contractName === contractName).address;
};

const { parseUnits } = require("@ethersproject/units");
const _ = require("lodash");
const { getDecimals } = require("./utils");

const argv = require("minimist")(process.argv.slice(), { string: ["collateral", "fee", "polygonCollateral"] });

async function runExport() {
  console.log("Running Upgrade Verifier🔥");

  if (!argv.collateral || !argv.fee) {
    throw "Must provide --fee and --collateral";
  }

  const collaterals = _.castArray(argv.collateral);
  const fees = _.castArray(argv.fee);
  const decimals = _.castArray(argv.decimals);
  const polygonCollaterals = _.castArray(argv.polygonCollateral);

  const argObjects = _.zipWith(collaterals, fees, decimals, (collateral, fee, numDecimalsArg) => {
    return { collateral, fee, numDecimalsArg };
  });

  const whitelist = await AddressWhitelist.deployed();

  for (const { collateral, fee, numDecimalsArg } of argObjects) {
    const decimal = await getDecimals(collateral, numDecimalsArg, ERC20);

    const store = await Store.deployed();
    assert.equal((await store.computeFinalFee(collateral)).rawValue, parseUnits(fee, decimal).toString());

    assert(await whitelist.isOnWhitelist(collateral));
  }

  // Check for latest event RelayedGovernanceRequest event emitted by GovernorRootTunnel. We can't query for more events
  // easily when using a ganache fork, so we'll just verify that the latest one was emitted properly.
  const governorTunnel = await GovernorRootTunnel.deployed();
  const relayedGovernanceRequest = await governorTunnel.getPastEvents("RelayedGovernanceRequest", {
    filter: { to: getContractAddressByName("AddressWhitelist") },
  });
  // This event should correspond to the last AddressWhitelist transaction, which is pushed last into the transaction array
  // in the 1_Propose.js script.
  const polygonCollateralWhitelistData = whitelist.contract.methods
    .addToWhitelist(polygonCollaterals[polygonCollaterals.length - 1])
    .encodeABI();
  assert.equal(relayedGovernanceRequest[0].returnValues.data, polygonCollateralWhitelistData);
  console.log("Last RelayedGovernanceRequest event contains correct AddressWhitelist ABI data");

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
