const getDefaultAccount = require("../wallet/getDefaultAccount");
const style = require("../textStyle");
const { batchRetrieveRewards } = require("../../../../common/VotingUtils");
const getAvailableRewards = require("./getRewardsByRoundId");
const inquirer = require("inquirer");
const argv = require("minimist")(process.argv.slice());

/**
 * This prompts the user to select from a list of round ID's that have one or more rewards that can be retrieved.
 * For the selected round ID, we batch retrieve all of the rewards for the round.
 *
 * @param {* Object} web3 Web3 provider
 * @param {* Object} voting deployed Voting.sol contract instance
 */
const retrieveRewards = async (web3, voting, designatedVoting) => {
  // TODO(#901): MetaMask provider sometimes has trouble reading past events
  if (argv.network === "metamask") {
    console.log(
      "Sorry, we currently do not support retrieving rewards for Metamask users! Try again with another web3 provider."
    );
    return;
  }

  style.spinnerReadingContracts.start();
  // If the user is using the two key contract, then the account is the designated voting contract's address
  const account = designatedVoting ? designatedVoting.address : await getDefaultAccount(web3);
  const { rewardsByRoundId, roundIds } = await getAvailableRewards(web3, voting, account);
  style.spinnerReadingContracts.stop();

  if (roundIds.length > 0) {
    console.group(
      `${style.instruction(
        "\nPlease select which round ID of resolved price requests you would like to retrieve rewards for:"
      )}`
    );
    roundIds.push({ name: "back" });
    const list = await inquirer.prompt({
      type: "list",
      name: "roundIdList",
      message:
        "You will retrieve rewards for all price requests for the round ID you select. You can only retrieve rewards for price requests that you have voted (committed AND revealed) and that have resolved.",
      choices: roundIds
    });
    if (list["roundIdList"] !== "back") {
      const roundId = list["roundIdList"];
      const resolvedVotes = rewardsByRoundId[roundId];

      // Batch retrieve rewards
      style.spinnerWritingContracts.start();
      const { successes, batches } = await batchRetrieveRewards(resolvedVotes, roundId, voting, account);
      style.spinnerWritingContracts.stop();

      // Print results
      console.log(
        style.success(
          `You have successfully retrieved ${successes.length} reward${
            successes.length === 1 ? "" : "s"
          } in ${batches} batch${batches === 1 ? "" : "es"}.`
        )
      );
      console.group(style.success("Receipts:"));
      for (let i = 0; i < successes.length; i++) {
        console.log(`- transaction: ${style.link(`https://etherscan.io/tx/${successes[i].txnHash}`)}`);
      }
      console.groupEnd();
    }
    console.log("\n");
    console.groupEnd();
  } else {
    console.log("You have no rewards to retrieve.");
  }
};

module.exports = retrieveRewards;
