const inquirer = require("inquirer");
const style = require("../textStyle");
const getDefaultAccount = require("../wallet/getDefaultAccount");
const filterRequests = require("./filterRequestsByRound");
const { VotePhasesEnum } = require("../../../../common/Enums");
const constructReveal = require("./constructReveal");
const batchRevealVotes = require("./batchRevealVotes");

module.exports = async (web3, voting) => {
  style.spinnerReadingContracts.start();
  const pendingRequests = await voting.getPendingRequests();
  const roundId = await voting.getCurrentRoundId();
  const roundPhase = await voting.getVotePhase();
  const account = await getDefaultAccount(web3);
  const filteredRequests = await filterRequests(pendingRequests, account, roundId, roundPhase, voting);
  style.spinnerReadingContracts.stop();

  if (roundPhase.toString() === VotePhasesEnum.COMMIT) {
    console.log(
      `The current vote phase is the "commit" phase; in the commit phase you can vote on pending price requests. You cannot reveal votes during this phase.`
    );
  } else if (filteredRequests.length === 0) {
    console.log(`No pending votes to reveal!`);
  } else {
    console.group(`${style.bgGreen(`\nPlease select which price requests you would like to reveal votes for`)}`);

    // To display properly, give each request a 'value' parameter
    for (let i = 0; i < filteredRequests.length; i++) {
      let request = filteredRequests[i];
      request.value = `${web3.utils.hexToUtf8(request.identifier)} @ ${style.formatSecondsToUtc(
        parseInt(request.time)
      )}`;
    }

    const checkbox = await inquirer.prompt({
      type: "checkbox",
      name: "requestsCheckbox",
      message: `Revealing a vote makes the vote final.`,
      choices: filteredRequests
    });
    if (checkbox["requestsCheckbox"]) {
      const newReveals = [];
      const failures = [];

      // Prompt user to enter a price per vote construct commitments for the votes
      const selections = checkbox["requestsCheckbox"];
      for (let i = 0; i < selections.length; i++) {
        // Look up raw request data from checkbox value
        let selectedRequest;
        for (let j = 0; j < filteredRequests.length; j++) {
          let request = filteredRequests[j];
          if (request.value === selections[i]) {
            selectedRequest = request;
            break;
          }
        }

        // Construct commitment
        try {
          newReveals.push(await constructReveal(selectedRequest, roundId, web3, account, voting));
        } catch (err) {
          failures.push({ selectedRequest, err });
        }
      }

      // Batch reveal the votes and display a receipt to the user
      if (newReveals.length > 0) {
        const { successes, batches } = await batchRevealVotes(newReveals, voting, account);

        // Print results
        console.log(
          style.bgGreen(
            `You have successfully revealed ${successes.length} price${
              successes.length === 1 ? "" : "s"
            } in ${batches} batch${batches === 1 ? "" : "es"}. (Failures = ${failures.length})`
          )
        );
        console.group(style.bgGreen(`Receipts:`));
        for (let i = 0; i < successes.length; i++) {
          console.log(`- transaction: ${style.link(`https://etherscan.io/tx/${successes[i].txnHash}`)}`);
        }
        console.groupEnd();
      } else {
        console.log(`You have not successfully revealed any votes`);
      }
    } else {
      console.log(`You have not selected any requests.`);
    }
    console.log(`\n`);
    console.groupEnd();
  }
};
