// This script generates and submits a collateral removal transaction to the DVM. It can be run on a local ganache
// fork of the mainnet or can be run directly on the mainnet to execute the upgrade transactions.
// To run this on the localhost first fork mainnet into Ganache with the proposerWallet unlocked as follows:
// ganache-cli --fork https://mainnet.infura.io/v3/5f56f0a4c8844c96a430fbd3d7993e39 --unlock 0x2bAaA41d155ad8a4126184950B31F50A1513cE25 --unlock 0x7a3a1c2de64f20eb5e916f40d11b01c441b2a8dc --port 9545
// Then execute the script as: yarn truffle exec ./scripts/remove-collateral-upp/1_Propose.js --network mainnet-fork --collateral 0x84810bcf08744d5862b8181f12d17bfd57d3b078 from core

const { getTruffleContract } = require("../../dist/index");

const AddressWhitelist = getTruffleContract("AddressWhitelist", web3, "latest");
const Finder = getTruffleContract("Finder", web3, "latest");
const Governor = getTruffleContract("Governor", web3, "latest");
const Voting = getTruffleContract("Voting", web3, "latest");

const { interfaceName } = require("@uma/common");
const { GasEstimator } = require("@uma/financial-templates-lib");

const _ = require("lodash");
const winston = require("winston");

const argv = require("minimist")(process.argv.slice(), { string: ["collateral"] });

const proposerWallet = "0x2bAaA41d155ad8a4126184950B31F50A1513cE25";

async function runExport() {
  console.log("Running Upgrade🔥");

  const netId = await web3.eth.net.getId();
  console.log("Connected to network id", netId);

  const gasEstimator = new GasEstimator(winston.createLogger({ silent: true }), 60, netId);

  if (!argv.collateral) {
    throw new Error("Must provide --collateral");
  }

  const collaterals = _.castArray(argv.collateral);

  const argObjects = _.zipWith(collaterals, (collateral) => {
    return { collateral };
  });

  const getTxns = async ({ collateral }) => {
    console.log("Examining collateral", collateral);

    const txns = [];

    // The proposal will remove the currency from the whitelist.
    const whitelist = await AddressWhitelist.deployed();
    if (!(await whitelist.isOnWhitelist(collateral))) {
      throw new Error("Collateral not on whitelist");
    } else {
      console.log("Collateral", collateral, "is on the whitelist. Removing it.");
      const removeCollateralFromWhitelistTx = whitelist.contract.methods.removeFromWhitelist(collateral).encodeABI();
      console.log("removeCollateralFromWhitelistTx", removeCollateralFromWhitelistTx);
      txns.push({ to: whitelist.address, value: 0, data: removeCollateralFromWhitelistTx });

      console.log("Collateral currency to remove:", collateral);
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
  await gasEstimator.update();
  const txn = await governor.propose(transactionList, { from: proposerWallet, ...gasEstimator.getCurrentFastPrice() });
  console.log("Transaction: ", txn?.tx);

  const finder = await Finder.deployed();
  const oracleAddress = await finder.getImplementationAddress(web3.utils.utf8ToHex(interfaceName.Oracle));
  console.log(`Governor submitting admin request to Voting @ ${oracleAddress}`);

  const oracle = await Voting.deployed();
  const priceRequests = await oracle.getPastEvents("PriceRequestAdded", { fromBlock: txn.block });

  const newAdminRequest = priceRequests[priceRequests.length - 1];
  console.log(
    `New admin request {identifier: ${
      newAdminRequest.args.identifier
    }, timestamp: ${newAdminRequest.args.time.toString()}}`
  );

  console.log("Done!");
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
