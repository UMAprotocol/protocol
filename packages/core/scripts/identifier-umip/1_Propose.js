// This script generates and submits an identifier-add upgrade transaction to the DVM. It can be run on a local ganache
// fork of the mainnet or can be run directly on the mainnet to execute the upgrade transactions.
// To run this on the localhost first fork mainnet into Ganache with the proposerWallet unlocked as follows:
// ganache-cli --fork https://mainnet.infura.io/v3/5f56f0a4c8844c96a430fbd3d7993e39 --unlock 0x2bAaA41d155ad8a4126184950B31F50A1513cE25 --unlock 0x7a3a1c2de64f20eb5e916f40d11b01c441b2a8dc --port 9545
// Then execute the script as: yarn truffle exec ./scripts/identifier-umip/1_Propose.js --network mainnet-fork --identifier USDETH --identifier ETHBTC from core

const { getTruffleContract } = require("../../dist/index");

// Use the same ABI's as deployed contracts:
const Governor = getTruffleContract("Governor", web3, "latest");
const IdentifierWhitelist = getTruffleContract("IdentifierWhitelist", web3, "latest");
const Finder = getTruffleContract("Finder", web3, "latest");
const Voting = getTruffleContract("Voting", web3, "latest");

const { interfaceName } = require("@uma/common");
const { GasEstimator } = require("@uma/financial-templates-lib");

const argv = require("minimist")(process.argv.slice(), { string: ["identifier"] });

const winston = require("winston");

const proposerWallet = "0x2bAaA41d155ad8a4126184950B31F50A1513cE25";

async function runExport() {
  console.log("Running Upgrade🔥");

  const netId = await web3.eth.net.getId();
  console.log("Connected to network id", netId);

  const gasEstimator = new GasEstimator(
    winston.createLogger({ silent: true }),
    60, // Time between updates.
    netId
  );

  if (!argv.identifier) {
    throw new Error("Must specify --identifier");
  }

  // argv.identifier may be an array or a single string (if only one is desired).
  // In either case, `identifiers` should be an array.
  let identifiers;
  if (Array.isArray(argv.identifier)) {
    identifiers = argv.identifier;
  } else {
    identifiers = [argv.identifier];
  }

  const identifierWhitelist = await IdentifierWhitelist.deployed();
  const governor = await Governor.deployed();

  // Generate the list of transactions from the list of identifiers.
  const transactions = identifiers.map((identifier) => {
    const identifierBytes = web3.utils.utf8ToHex(identifier);
    const addIdentifierTx = identifierWhitelist.contract.methods.addSupportedIdentifier(identifierBytes).encodeABI();
    console.log("addIdentifierTx", addIdentifierTx);
    return { to: identifierWhitelist.address, value: 0, data: addIdentifierTx };
  });

  await gasEstimator.update();
  const txn = await governor.propose(transactions, {
    from: proposerWallet,
    gasPrice: gasEstimator.getCurrentFastPrice(),
  });

  const identifierTable = identifiers.map((identifier) => {
    return { identifier, hex: web3.utils.utf8ToHex(identifier) };
  });

  console.log(`
  Identifiers Proposed`);
  console.table(identifierTable);

  console.log("Transaction: ", txn?.tx);

  const finder = await Finder.deployed();
  const oracleAddress = await finder.getImplementationAddress(web3.utils.utf8ToHex(interfaceName.Oracle));
  console.log(`Governor submitting admin request to Voting @ ${oracleAddress}`);

  const oracle = await Voting.deployed();
  const priceRequests = await oracle.getPastEvents("PriceRequestAdded");

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
