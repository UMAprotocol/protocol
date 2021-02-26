// This script generates and submits an identifier-add upgrade transaction to the DVM. It can be run on a local ganache
// fork of the main net or can be run directly on the main net to execute the upgrade transactions.
// To run this on the localhost first fork main net into Ganache with the proposerWallet unlocked as follows:
// ganache-cli --fork https://mainnet.infura.io/v3/5f56f0a4c8844c96a430fbd3d7993e39 --unlock 0x2bAaA41d155ad8a4126184950B31F50A1513cE25 --unlock 0x7a3a1c2de64f20eb5e916f40d11b01c441b2a8dc --port 9545
// Then execute the script as: yarn truffle exec ./scripts/collateral-umip/1_Propose.js --network mainnet-fork --collateral 0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2 --fee 0.1 --collateral 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 --fee 400 from core
// Note: the fees will be scaled with the decimals of the referenced token. The collateral-fee-(optional decimal)
// triplets should be specified in order as above. The first collateral value will be paired with the first fee value and so on.

const AddressWhitelist = artifacts.require("AddressWhitelist");
const Store = artifacts.require("Store");
const Finder = artifacts.require("Finder");
const Governor = artifacts.require("Governor");
const ERC20 = artifacts.require("ERC20");
const Voting = artifacts.require("Voting");

const { interfaceName } = require("@uma/common");

const { parseUnits } = require("@ethersproject/units");
const { getDecimals } = require("./utils");

const _ = require("lodash");

const argv = require("minimist")(process.argv.slice(), { string: ["collateral", "fee", "decimals"] });

const proposerWallet = "0x2bAaA41d155ad8a4126184950B31F50A1513cE25";

async function runExport() {
  console.log("Running Upgrade🔥");
  console.log("Connected to network id", await web3.eth.net.getId());

  if (!argv.collateral || !argv.fee) {
    throw new Error("Must provide --fee and --collateral");
  }

  const collaterals = _.castArray(argv.collateral);
  const fees = _.castArray(argv.fee);
  const decimals = argv.decimals && _.castArray(argv.decimals);

  if (collaterals.length !== fees.length || (decimals && decimals.length !== collaterals.length)) {
    throw new Error("Must provide the same number of elements to --fee, --collateral, and --decimals (optional)");
  }

  const argObjects = _.zipWith(collaterals, fees, decimals, (collateral, fee, numDecimalsArg) => {
    return { collateral, fee, numDecimalsArg };
  });

  const getTxns = async ({ collateral, fee, numDecimalsArg }) => {
    const decimals = await getDecimals(collateral, numDecimalsArg, ERC20);
    console.log("Examining collateral", collateral);
    const convertedFeeAmount = parseUnits(fee, decimals).toString();
    console.log(`Fee in token's decimals: ${convertedFeeAmount}`);

    const txns = [];

    // The proposal will first add a final fee for the currency.
    const store = await Store.deployed();
    const addFinalFeeToStoreTx = store.contract.methods
      .setFinalFee(collateral, { rawValue: convertedFeeAmount })
      .encodeABI();
    console.log("addFinalFeeToStoreTx", addFinalFeeToStoreTx);
    txns.push({
      to: store.address,
      value: 0,
      data: addFinalFeeToStoreTx
    });

    // The proposal will then add the currency to the whitelist if it isn't already there.
    const whitelist = await AddressWhitelist.deployed();
    if (!(await whitelist.isOnWhitelist(collateral))) {
      console.log("Collateral", collateral, "is not on the whitelist. Adding it.");
      const addCollateralToWhitelistTx = whitelist.contract.methods.addToWhitelist(collateral).encodeABI();
      console.log("addCollateralToWhitelistTx", addCollateralToWhitelistTx);
      txns.push({
        to: whitelist.address,
        value: 0,
        data: addCollateralToWhitelistTx
      });

      console.log(`

      Collateral currency: ${collateral}
      Final fee: ${fee}
      
      `);
    }

    return txns;
  };

  let transactionList = [];
  for (let argObject of argObjects) {
    const transactionsToAdd = await getTxns(argObject);
    transactionList = [...transactionList, ...transactionsToAdd];
  }

  const governor = await Governor.deployed();
  console.log(`Sending to governor @ ${governor.address}`);

  // Send the proposal
  const txn = await governor.propose(transactionList, { from: proposerWallet, gas: 2000000 });
  console.log("Transaction: ", txn?.tx);

  const finder = await Finder.deployed();
  const oracleAddress = await finder.getImplementationAddress(web3.utils.utf8ToHex(interfaceName.Oracle));
  console.log(`Governor submitting admin request to Voting @ ${oracleAddress}`);

  const oracle = await Voting.at(oracleAddress);
  const priceRequests = await oracle.getPastEvents("PriceRequestAdded");

  const newAdminRequest = priceRequests[priceRequests.length - 1];
  console.log(
    `New price request {identifier: ${
      newAdminRequest.args.identifier
    }, timestamp: ${newAdminRequest.args.time.toString()}}`
  );

  console.log(`

Done!

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
