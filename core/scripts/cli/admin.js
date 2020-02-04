const inquirer = require("inquirer");
const abiDecoder = require("../../../common/AbiUtils.js").getAbiDecoder();
const style = require("./textStyle");

async function decodeGovernorProposal(artifacts, id) {
  const Governor = artifacts.require("Governor");
  const governor = await Governor.deployed();
  const proposal = await governor.getProposal(id);

  console.group();
  console.log("Retrieved Admin Proposal for ID:", id);
  console.log("Proposal has", proposal.transactions.length, " transactions");
  for (let i = 0; i < proposal.transactions.length; i++) {
    console.group();
    console.log("Transaction", i);

    const transaction = proposal.transactions[i];

    // Give to and value.
    console.log("To: ", transaction.to);
    console.log("Value (in Wei): ", transaction.value);

    if (!transaction.data || transaction.data.length === 0 || transaction.data === "0x") {
      // No data -> simple ETH send.
      console.log("Transaction is a simple ETH send (no data).");
    } else {
      // Txn data isn't empty -- attempt to decode.
      const decodedTxn = abiDecoder.decodeMethod(transaction.data);
      if (!decodedTxn) {
        // Cannot decode txn, just give the user the raw data.
        console.log("Cannot decode transaction (does not match any UMA Protocol Signature.");
        console.log("Raw transaction data:", transaction.data);
      } else {
        // Decode was successful -- pretty print the results.
        console.log("Transaction details:");
        console.log(JSON.stringify(decodedTxn, null, 4));
      }
    }
    console.groupEnd();
  }
  console.groupEnd();
}

async function decodeAllActiveGovernorProposals(artifacts, web3) {
  const Voting = artifacts.require("Voting");
  const voting = await Voting.deployed();

  // Search through pending requests to find active governor proposals.
  const pendingRequests = await voting.getPendingRequests();
  const adminRequests = [];
  const adminPrefix = "Admin ";
  for (const pendingRequest of pendingRequests) {
    const identifier = web3.utils.hexToUtf8(pendingRequest.identifier);
    if (identifier.startsWith(adminPrefix)) {
      // This is an admin proposal.
      const id = parseInt(identifier.slice(adminPrefix.length));
      adminRequests.push(id);
    }
  }

  // Query each proposal and print details.
  console.log("There are", adminRequests.length, "active admin proposals.");
  console.group();
  for (const id of adminRequests) {
    await decodeGovernorProposal(artifacts, id);
  }
  console.groupEnd();
}

async function viewAdminMenu(maxId) {
  const prompts = [
    {
      type: "input",
      name: "viewAdminMenu",
      message: `Please enter an admin proposal id (0-${maxId}), Enter to see all active admin proposals, or 'exit' to quit.`
    }
  ];

  const result = await inquirer.prompt(prompts);
  return result["viewAdminMenu"];
}

async function admin(artifacts, web3) {
  style.spinnerReadingContracts.start();
  const Governor = artifacts.require("Governor");
  const governor = await Governor.deployed();
  const numProposals = await governor.numProposals();
  style.spinnerReadingContracts.stop();

  if (numProposals.toString() === "0") {
    console.log("No admin proposals have been issued on this network.");
    return;
  }

  while (true) {
    const maxId = numProposals.subn(1).toString();
    const userEntry = await viewAdminMenu(maxId);

    if (userEntry) {
      // User entered something.
      let id = parseInt(userEntry);

      // Detect exit command.
      if (userEntry.startsWith("exit")) {
        console.log("Exiting admin menu...");
        break;
      }

      // Validate input.
      if (Number.isNaN(id) || numProposals.lten(id) || id < 0) {
        console.log(userEntry, `is not a valid admin proposal id. Please enter an integer between 0 and ${maxId}`);
        continue;
      }

      await decodeGovernorProposal(artifacts, id);
    } else {
      // No selection was entered, show all admin proposals.
      await decodeAllActiveGovernorProposals(artifacts, web3);
    }

    break;
  }
}

module.exports = admin;
