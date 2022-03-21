// Description:
// - Resolve all possible proposals for a specific sender.

// Usage:
// NODE_URL_1=http://localhost:9545 \
//  node ./packages/scripts/src/admin-proposals/resolveProposal.js \
//  --network mainnet_mnemonic \
//  --sender <ADDRESS>

require("dotenv").config();
const { getWeb3ByChainId } = require("@uma/common");
const { setupGasEstimator } = require("./utils");
const {
  aggregateTransactionsAndSend,
  multicallAddressMap,
  aggregateTransactionsAndCall,
} = require("@uma/financial-templates-lib");
const { _getContractAddressByName } = require("../utils");

const hre = require("hardhat");
const { getContract } = hre;
const Proposer = getContract("Proposer");
const Governor = getContract("Governor");
const argv = require("minimist")(process.argv.slice(), {
  string: [
    // proposer address to resolve proposals for
    "sender",
  ],
});

async function run() {
  const web3 = getWeb3ByChainId(1);
  const accounts = await web3.eth.getAccounts();
  const sender = argv.sender;

  // Initialize Eth contracts by grabbing deployed addresses from networks/1.json file.
  const gasEstimator = await setupGasEstimator();

  const proposer = new web3.eth.Contract(Proposer.abi, await _getContractAddressByName("Proposer", 1));
  const governor = new web3.eth.Contract(Governor.abi, await _getContractAddressByName("Governor", 1));

  // Query the state of all possible bonded proposals and determine which ones can be resolved. If the `lockedBond`
  // property of the `bondedProposal` is 0 then the proposal cannot be resolved.
  const totalProposals = Number(await governor.methods.numProposals().call());
  const bondedProposalTransactions = [...Array(totalProposals).keys()].map((i) => {
    return { target: proposer.options.address, callData: proposer.methods.bondedProposals(i).encodeABI() };
  });

  console.group(`\n📢 There are a total of ${totalProposals.length} possible resolvable proposals`);

  // Read bonded proposal state in a single batched web3 call:
  console.log("- Reading bondedProposals() state for all ids...");
  const bondedProposals = await aggregateTransactionsAndCall(
    multicallAddressMap.mainnet.multicall,
    web3,
    bondedProposalTransactions
  );

  const proposalToResolve = [];
  for (let i = 0; i < bondedProposals.length; i++) {
    if (web3.utils.toBN(bondedProposals[i].lockedBond.toString()).gt(web3.utils.toBN("0"))) {
      console.log(
        `- Proposal #${i} has a locked bond of ${bondedProposals[i].lockedBond.toString()} UMA, proposer was @ ${
          bondedProposals[i].sender
        }`
      );
      if (bondedProposals[i].sender === sender) {
        proposalToResolve.push(i);
      } else {
        console.log(`Skipping proposal #${i}, only resolving bonded proposals where sender is ${sender}`);
      }
    }
  }

  if (proposalToResolve.length === 0) {
    console.groupEnd("No proposals to resolve.");
  } else {
    console.log(`- Resolving ${proposalToResolve.length} proposals: ${proposalToResolve}`);
    const resolveProposalTransactions = proposalToResolve.map((i) => {
      return { target: proposer.options.address, callData: proposer.methods.resolveProposal(i).encodeABI() };
    });
    const txn = await aggregateTransactionsAndSend(
      multicallAddressMap.mainnet.multicall,
      web3,
      resolveProposalTransactions,
      { from: accounts[0], ...gasEstimator.getCurrentFastPrice() }
    );
    console.groupEnd("Transaction: ", txn?.transactionHash);
  }
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
