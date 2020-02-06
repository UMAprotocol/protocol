const getDefaultAccount = require("../wallet/getDefaultAccount");
const style = require("../textStyle");
const batchRetrieveRewards = require("./batchRetrieveRewards");
const getResolvedVotesByRoundId = require("./getResolvedVotesByRoundId");
const inquirer = require("inquirer");

module.exports = async (web3, voting) => {
  style.spinnerReadingContracts.start();
  const account = await getDefaultAccount(web3);
  const { resolvedVotesByRoundId, roundIds } = await getResolvedVotesByRoundId(web3, voting, account);
  style.spinnerReadingContracts.stop();

  if (roundIds.length > 0) {
    console.group(
      `${style.bgRed(
        `\nPlease select which round ID of resolved price requests you would like to retrieve rewards for`
      )}`
    );
    roundIds.push({ name: "back" });
    const list = await inquirer.prompt({
      type: "list",
      name: "roundIdList",
      message: `You will retrieve rewards for all price requests for the round ID you select. You can only retrieve rewards for price requests that you have voted (committed AND revealed) and that have resolved.`,
      choices: roundIds
    });
    if (list["roundIdList"] !== "back") {
      const roundId = list["roundIdList"];
      const resolvedVotes = resolvedVotesByRoundId[roundId];

      // Batch retrieve rewards
      const { successes, batches } = await batchRetrieveRewards(resolvedVotes, roundId, voting, account);

      // Print results
      console.log(
        style.bgGreen(
          `You have successfully retrieved ${successes.length} reward${
            successes.length === 1 ? "" : "s"
          } in ${batches} batch${batches === 1 ? "" : "es"}.`
        )
      );
      console.group(style.bgGreen(`Receipts:`));
      for (let i = 0; i < successes.length; i++) {
        console.log(`- transaction: ${style.link(`https://etherscan.io/tx/${successes[i].txnHash}`)}`);
      }
      console.groupEnd();
    }
    console.log(`\n`);
    console.groupEnd();
  } else {
    console.log(`You have no rewards to retrieve`);
  }
};
