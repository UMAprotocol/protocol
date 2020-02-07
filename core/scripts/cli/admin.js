const inquirer = require("inquirer");
const abiDecoder = require("../../../common/AbiUtils.js").getAbiDecoder();
const style = require("./textStyle");
const { isAdminRequest, getAdminRequestId, decodeTransaction } = require("../../../common/AdminUtils.js");

async function decodeGovernorProposal(artifacts, id) {
  const Governor = artifacts.require("Governor");
  const governor = await Governor.deployed();
  const proposal = await governor.getProposal(id);

  console.group();
  console.log("Retrieved Admin Proposal for ID:", id);
  console.log(
    `Proposal has ${proposal.transactions.length} transaction${proposal.transactions.length === 1 ? "" : "s"}`
  );
  for (let i = 0; i < proposal.transactions.length; i++) {
    console.group();
    console.log("Transaction", i);

    const transaction = proposal.transactions[i];
    const strForm = decodeTransaction(transaction);
    console.log(strForm);

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
  for (const pendingRequest of pendingRequests) {
    const identifier = web3.utils.hexToUtf8(pendingRequest.identifier);
    if (isAdminRequest(identifier)) {
      adminRequests.push(getAdminRequestId(identifier));
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
