// Description:
// - Executes specific approved Admin proposal.

// Run:
// - Start mainnet fork in one window with `yarn hardhat node --fork <ARCHIVAL_NODE_URL> --no-deploy --port 9545`
// - Next, open another terminal window and run `node ./packages/scripts/admin-proposals/setupFork.sh` to unlock
//   accounts on the local node that we'll need to run this script.
// - This script should be run after any Admin proposal UMIP script against a local Mainnet fork. It allows the tester
//   to simulate what would happen if the proposal were to pass and to verify that contract state changes as expected.
// - Execute proposal 10:
//   node ./packages/scripts/admin-proposals/executeProposal.js --id 10 --network mainnet-fork

const hre = require("hardhat");
const { getContract } = hre;
require("dotenv").config();
const { GasEstimator } = require("@uma/financial-templates-lib");
const winston = require("winston");
const { _getContractAddressByName, _setupWeb3 } = require("../utils");
const argv = require("minimist")(process.argv.slice(), {
  string: [
    // proposal ID to execute
    "id",
  ],
});

async function run() {
  // Set up provider so that we can sign from special wallets. This script is designed to only run against local mainnet
  // forks.
  const { netId, web3 } = await _setupWeb3();
  const accounts = await web3.eth.getAccounts();

  // Contract ABI's
  const Governor = getContract("Governor");

  // Initialize Eth contracts by grabbing deployed addresses from networks/1.json file.
  const gasEstimator = new GasEstimator(
    winston.createLogger({ silent: true }),
    60, // Time between updates.
    netId
  );
  await gasEstimator.update();
  console.log(
    `⛽️ Current fast gas price for Ethereum: ${web3.utils.fromWei(
      gasEstimator.getCurrentFastPrice().maxFeePerGas.toString(),
      "gwei"
    )} maxFeePerGas and ${web3.utils.fromWei(
      gasEstimator.getCurrentFastPrice().maxPriorityFeePerGas.toString(),
      "gwei"
    )} maxPriorityFeePerGas`
  );
  const governor = new web3.eth.Contract(Governor.abi, _getContractAddressByName("Governor", netId));
  console.group("\nℹ️  DVM infrastructure for Ethereum transactions:");
  console.log(`- Governor @ ${governor.options.address}`);
  console.groupEnd();

  // Execute the most recent admin vote that we haven't already executed.
  const id = Number(argv.id);
  console.group(`\n📢 Executing Governor Proposal ${id}`);
  const totalProposals = Number(await governor.methods.numProposals().call());
  console.log(`- Max available proposal ID: ${totalProposals - 1}`);
  const proposal = await governor.methods.getProposal(id.toString()).call();
  for (let j = 0; j < proposal.transactions.length; j++) {
    console.log(`- Submitting transaction #${j + 1} from proposal #${id}`);
    try {
      let txn = await governor.methods
        .executeProposal(id.toString(), j.toString())
        .send({ from: accounts[0], ...gasEstimator.getCurrentFastPrice() });
      console.log(`    - Success, receipt: ${txn.transactionHash}`);
    } catch (err) {
      console.error("    - Failure: Txn was likely executed previously, skipping to next one");
      continue;
    }
  }

  console.log("\n😇 Success!");
}

function main() {
  const startTime = Date.now();
  run()
    .catch((err) => {
      console.error(err);
    })
    .finally(() => {
      const timeElapsed = Date.now() - startTime;
      console.log(`Done in ${(timeElapsed / 1000).toFixed(2)}s`);
    });
}
main();
