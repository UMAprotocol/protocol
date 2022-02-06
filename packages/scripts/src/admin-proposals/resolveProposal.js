// Description:
// - Resolve specific proposal and retrieve bond.

require("dotenv").config();
const { getWeb3ByChainId } = require("@uma/common");
const { setupGasEstimator } = require("./utils");
const { _getContractAddressByName } = require("../utils");
const argv = require("minimist")(process.argv.slice(), {
  string: [
    // proposal ID to resolve
    "id",
  ],
});
const hre = require("hardhat");
const { getContract } = hre;
const Proposer = getContract("Proposer");

async function run() {
  const web3 = getWeb3ByChainId(1);
  const accounts = await web3.eth.getAccounts();

  // Initialize Eth contracts by grabbing deployed addresses from networks/1.json file.
  const gasEstimator = await setupGasEstimator();

  // Execute the most recent admin vote that we haven't already executed.
  const id = Number(argv.id);
  console.group(`\n📢 Resolving Proposal ${id}`);

  const proposer = new web3.eth.Contract(Proposer.abi, await _getContractAddressByName("Proposer", 1));
  const bondedProposal = await proposer.methods.bondedProposals(id.toString()).call();
  console.log(
    `- Proposal #${id} has a locked bond of ${bondedProposal.lockedBond.toString()} UMA, proposer was @ ${
      bondedProposal.sender
    }`
  );
  try {
    const txn = await proposer.methods
      .resolveProposal(id.toString())
      .send({ from: accounts[0], ...gasEstimator.getCurrentFastPrice() });
    console.log("- Transaction: ", txn?.transactionHash);
  } catch (err) {
    console.log("- Resolution failed, has price been resolved for admin proposal?", err);
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
