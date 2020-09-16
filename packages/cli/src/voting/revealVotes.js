const inquirer = require("inquirer");
const style = require("../textStyle");
const getDefaultAccount = require("../wallet/getDefaultAccount");
const filterRequests = require("./filterRequestsByRound");
const { constructReveal, batchRevealVotes, getVotingRoles, VotePhasesEnum } = require("@uma/common");

/**
 * This prompts the user to select which pending price requests, that they have committed votes on, they want to reveal.
 * A vote can only be revealed once, unlike a commit.
 *
 * @param {* Object} web3 Web3 provider
 * @param {* Object} oracle deployed Voting.sol contract instance
 */
const revealVotes = async (web3, oracle, designatedVoting) => {
  style.spinnerReadingContracts.start();
  const pendingRequests = await oracle.getPendingRequests();
  const roundId = await oracle.getCurrentRoundId();
  const roundPhase = await oracle.getVotePhase();
  const round = await oracle.rounds(roundId);
  const account = await getDefaultAccount(web3);

  // If the user is using the two key contract, then the voting account is the designated voting contract's address.
  const { votingAccount, signingAddress, votingContract } = getVotingRoles(account, oracle, designatedVoting);

  const filteredRequests = await filterRequests(web3, pendingRequests, votingAccount, roundId, roundPhase, oracle);
  style.spinnerReadingContracts.stop();

  if (roundPhase.toString() === VotePhasesEnum.COMMIT) {
    console.log(
      'The current vote phase is the "commit" phase; in the commit phase you can vote on pending price requests. You cannot reveal votes during this phase.'
    );
  } else if (filteredRequests.length === 0) {
    console.log("No pending votes to reveal!");
  } else if (round.snapshotId.toString() === "0") {
    console.log("Snapshot must be taken before reveal");
  } else {
    // To display properly, give each request a 'value' parameter
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
        "Please select which price requests you would like to reveal votes for. Revealing a vote makes the vote final.",
      choices: filteredRequests
    });
    if (checkbox["requestsCheckbox"]) {
      const newReveals = [];
      const failures = [];

      // Prompt user to enter a price per vote construct commitments for the votes
      const selections = checkbox["requestsCheckbox"];
      for (let i = 0; i < selections.length; i++) {
        // Construct commitment
        try {
          newReveals.push(await constructReveal(selections[i], roundId, web3, signingAddress, oracle, votingAccount));
        } catch (err) {
          console.error(err);
          failures.push({ request: selections[i], err });
        }
      }

      // Batch reveal the votes and display a receipt to the user
      if (newReveals.length > 0) {
        style.spinnerWritingContracts.start();
        const { successes, batches } = await batchRevealVotes(newReveals, votingContract, signingAddress);
        style.spinnerWritingContracts.stop();

        // Print results
        console.log(
          style.success(
            `You have successfully revealed ${successes.length} price${
              successes.length === 1 ? "" : "s"
            } in ${batches} batch${batches === 1 ? "" : "es"}. (Failures = ${failures.length})`
          )
        );
        console.group(style.success("Receipts:"));
        for (let i = 0; i < successes.length; i++) {
          console.log(`- transaction: ${style.link(`https://etherscan.io/tx/${successes[i].txnHash}`)}`);
        }
        console.groupEnd();
      } else {
        console.log("You have not successfully revealed any votes");
      }
    } else {
      console.log("You have not selected any requests.");
    }
  }
};

module.exports = revealVotes;
