const inquirer = require("inquirer");
const style = require("../textStyle");
const getDefaultAccount = require("../wallet/getDefaultAccount");
const filterRequests = require("./filterRequestsByRound");
const {
  constructCommitment,
  batchCommitVotes,
  getVotingRoles,
  VotePhasesEnum,
  PublicNetworks,
  getPrecisionForIdentifier,
  formatFixed
} = require("@uma/common");

/**
 * This prompts the user twice from the command line interface:
 * first to select from a list of pending price requests, and second
 * to manually enter in a price on each request. The user can opt not to select any price
 * requests to vote on in the first step. In the second step, the user must enter a positive number, otherwise
 * the price entered will default to 0.
 *
 * The user can change their votes by committing another price to a pending price request
 *
 * @param {* Object} web3 Web3 provider
 * @param {* Object} oracle deployed Voting.sol contract instance
 */
const commitVotes = async (web3, oracle, designatedVoting) => {
  style.spinnerReadingContracts.start();
  const pendingRequests = await oracle.getPendingRequests();
  const roundId = await oracle.getCurrentRoundId();
  const roundPhase = (await oracle.getVotePhase()).toString();
  const account = await getDefaultAccount(web3);

  // If the user is using the two key contract, then the voting account is the designated voting contract's address.
  const { votingAccount, signingAddress, votingContract } = getVotingRoles(account, oracle, designatedVoting);

  const filteredRequests = await filterRequests(web3, pendingRequests, votingAccount, roundId, roundPhase, oracle);
  style.spinnerReadingContracts.stop();

  if (roundPhase === VotePhasesEnum.REVEAL) {
    console.log(
      'The current vote phase is the "reveal" phase; in the reveal phase, you can only reveal already committed votes. You cannot vote on price requests in this phase.'
    );
  } else if (filteredRequests.length === 0) {
    console.log("No pending price requests to commit votes for!");
  } else {
    // To display properly, give each request a 'name' parameter and set 'value' to the price request
    for (let i = 0; i < filteredRequests.length; i++) {
      let request = filteredRequests[i];
      request.name = `${web3.utils.hexToUtf8(request.identifier)} @ ${style.formatSecondsToUtc(
        parseInt(request.time)
      )}`;
      request.value = { identifier: request.identifier, time: request.time };
    }
    const checkbox = await inquirer.prompt({
      type: "checkbox",
      name: "requestsCheckbox",
      message:
        "Please select which price requests you would like to commit votes for. Afterwards, you will be prompted to manually enter in a price for each request in the order shown. You can change these votes later.",
      choices: filteredRequests
    });

    if (checkbox["requestsCheckbox"]) {
      const newCommitments = [];
      const failures = [];

      // Prompt user to enter a price per vote construct commitments for the votes
      const selections = checkbox["requestsCheckbox"];
      for (let i = 0; i < selections.length; i++) {
        // Prompt user to enter a price per vote and commit the votes
        const priceInput = await inquirer.prompt({
          type: "number",
          name: "price",
          default: 0.0,
          message: style.instruction("Enter a positive price. Invalid input will default to 0!"),
          validate: value => value >= 0 || "Price must be positive"
        });

        // Construct commitment
        try {
          const identifierPrecision = getPrecisionForIdentifier(web3.utils.hexToUtf8(selections[i].identifier));
          newCommitments.push(
            await constructCommitment(
              selections[i],
              roundId,
              web3,
              priceInput["price"],
              signingAddress,
              votingAccount,
              identifierPrecision
            )
          );
        } catch (err) {
          failures.push({ request: selections[i], err });
        }
      }

      // Batch commit the votes and display a receipt to the user
      if (newCommitments.length > 0) {
        style.spinnerWritingContracts.start();
        const { successes, batches } = await batchCommitVotes(newCommitments, votingContract, signingAddress);
        style.spinnerWritingContracts.stop();

        // Construct etherscan link based on network
        const networkId = web3.networkId;
        let url;
        if (PublicNetworks[networkId]) {
          url = `${PublicNetworks[networkId].etherscan}/tx/`;
        } else {
          // No URL for localhost, just show transaction ID
          url = "";
        }

        // Print results
        console.log(
          style.success(
            `You have successfully committed ${successes.length} price${
              successes.length === 1 ? "" : "s"
            } in ${batches} batch${batches === 1 ? "" : "es"}. (Failures = ${failures.length})`
          )
        );
        console.group(style.success("Receipts:"));
        successes.forEach(committedVote => {
          const identifierPrecision = getPrecisionForIdentifier(web3.utils.hexToUtf8(committedVote.identifier));
          console.log(`- transaction: ${style.link(`${url}${committedVote.txnHash}`)}`);
          console.log(`    - salt: ${committedVote.salt}`);
          console.log(`    - voted price: ${formatFixed(committedVote.price, identifierPrecision)}`);
        });
        console.groupEnd();
      } else {
        console.log("You have not entered valid prices for any votes");
      }
    } else {
      console.log("You have not selected any requests.");
    }
  }
};

module.exports = commitVotes;
