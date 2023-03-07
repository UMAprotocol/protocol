// Description:
// - Executes specific approved Admin proposal.

// Run:
// - Check out README.md in this folder for setup instructions and simulating votes between the Propose and Verify
//   steps.
// - This script should be run after any Admin proposal UMIP script against a local Mainnet fork. It allows the tester
//   to simulate what would happen if the proposal were to pass and to verify that contract state changes as expected.
// - Execute proposal 10:
//   NODE_URL_1=http://localhost:9545 node ./packages/scripts/src/admin-proposals/executeProposal.js --id 10 --network mainnet-fork

require("dotenv").config();
const { getWeb3ByChainId } = require("@uma/common");
const { setupGasEstimator, setupMainnet } = require("./utils");
const argv = require("minimist")(process.argv.slice(), {
  string: [
    // proposal ID to execute
    "id",
  ],
  boolean: [
    // set to True to use multicall to execute all transactions in a single tx
    "multicall",
  ],
  default: { multicall: false },
});

async function run() {
  // Set up provider so that we can sign from special wallets. This script is designed to only run against local mainnet
  // forks.
  const web3 = getWeb3ByChainId(1);
  const accounts = await web3.eth.getAccounts();

  // Initialize Eth contracts by grabbing deployed addresses from networks/1.json file.
  const gasEstimator = await setupGasEstimator();

  // Construct all mainnet contract instances we'll need using the mainnet web3 provider.
  const mainnetContracts = await setupMainnet(web3);

  // Execute the most recent admin vote that we haven't already executed.
  const id = Number(argv.id);
  console.group(`\n📢 Executing Governor Proposal ${id}`);
  const totalProposals = Number(await mainnetContracts.governor.methods.numProposals().call());
  console.log(`- Max available proposal ID: ${totalProposals - 1}`);
  const proposal = await mainnetContracts.governor.methods.getProposal(id.toString()).call();
  const currentNonce = await web3.eth.getTransactionCount(accounts[0]);
  let nonceIncrement = 0;

  if (argv.multicall) {
    console.log("Submitting proposal execution with multicall");

    const calls = [];
    for (let j = 0; j < proposal.transactions.length; j++) {
      console.log(`- Aggregating transaction #${j + 1} from proposal #${id}`);
      calls.push({
        target: mainnetContracts.governor.options.address,
        callData: mainnetContracts.governor.methods.executeProposal(id, j).encodeABI(),
      });
    }
    const txn = await mainnetContracts.multicall.methods
      .aggregate(calls)
      .send({ from: accounts[0], ...gasEstimator.getCurrentFastPrice() });
    console.log(`    - Success, receipt: ${txn.transactionHash}`);
  } else {
    for (let j = 0; j < proposal.transactions.length; j++) {
      console.log(`- Submitting transaction #${j + 1} from proposal #${id}`);
      try {
        let txn = await mainnetContracts.governor.methods
          .executeProposal(id.toString(), j.toString())
          .send({ from: accounts[0], ...gasEstimator.getCurrentFastPrice(), nonce: currentNonce + nonceIncrement });
        console.log(`    - Success, receipt: ${txn.transactionHash}`);
        nonceIncrement += 1;
      } catch (err) {
        console.error("    - Failure: Txn was likely executed previously, skipping to next one");
        continue;
      }
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
