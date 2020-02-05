const getDefaultAccount = require("../wallet/getDefaultAccount");
const style = require("../textStyle");
const batchRetrieveRewards = require("./batchRetrieveRewards");
const inquirer = require("inquirer");

module.exports = async (web3, voting) => {
  const account = await getDefaultAccount(web3);

  style.spinnerReadingContracts.start();
  // All rewards retrieved by user
  const retrievedRewards = await voting.getPastEvents("RewardsRetrieved", {
    filter: { voter: account },
    fromBlock: 0
  });
  // All votes revealed by user
  const revealedVotes = await voting.getPastEvents("VoteRevealed", {
    filter: { voter: account },
    fromBlock: 0
  });
  // Check if votes have resolved and not had their rewards retrieved yet
  const resolvedVotesByRoundId = {};
  const roundIds = [];
  for (let i = 0; i < revealedVotes.length; i++) {
    const identifier = revealedVotes[i].args.identifier;
    const time = revealedVotes[i].args.time;
    const roundId = revealedVotes[i].args.roundId;

    try {
      const price = await voting.getPrice(identifier, time);

      // Check if votes have already been retrieved
      let alreadyRetrieved = false;
      for (let j = 0; j < retrievedRewards.length; j++) {
        const retrievedReward = retrievedRewards[j];
        if (
          identifier === retrievedReward.args.identifier &&
          time.toString() === retrievedReward.args.time.toString()
        ) {
          // Vote already retrieved
          alreadyRetrieved = true;
          break;
        }
      }
      if (!alreadyRetrieved) {
        // Rewards can be retrieved!
        const _resolvedVote = {
          price: price.toString(),
          name: `${web3.utils.hexToUtf8(identifier)} @ ${style.formatSecondsToUtc(time.toString())}`,
          identifier,
          time: time.toString(),
          roundId: roundId.toString()
        };
        // If this is a new roundId, begin a new array
        if (!resolvedVotesByRoundId[roundId.toString()]) {
          roundIds.push({ name: roundId.toString() });
          resolvedVotesByRoundId[roundId.toString()] = [_resolvedVote];
        } else {
          resolvedVotesByRoundId[roundId.toString()].push(_resolvedVote);
        }
      } else {
        continue;
      }
    } catch (err) {
      console.error(err);
      // getPrice will throw if the vote has not resolved
      continue;
    }
  }
  style.spinnerReadingContracts.stop();

  if (roundIds.length > 0) {
    console.group(
      `${style.bgGreen(
        `\nPlease select which round ID of resolved price requests you would like to retrieve rewards for`
      )}`
    );
    const checkbox = await inquirer.prompt({
      type: "list",
      name: "roundIdList",
      message: `These uniquely identify the rounds during which a price vote resolves.`,
      choices: roundIds
    });
    if (checkbox["roundIdList"]) {
      const roundId = checkbox["roundIdList"];
      const resolvedVotes = resolvedVotesByRoundId[roundId];
      console.group(
        `${style.bgGreen(`\nPlease select which resolved price requests you would like to retrieve rewards for`)}`
      );
      if (resolvedVotes.length > 0) {
        const checkbox = await inquirer.prompt({
          type: "checkbox",
          name: "rewardsCheckbox",
          message: `You can only retrieve rewards for price requests that you voted on (i.e. committed and revealed a vote for) and that have resolved.`,
          choices: resolvedVotes
        });
        if (checkbox["rewardsCheckbox"]) {
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
        } else {
          console.log(`You have not selected any rewards to retrieve.`);
        }
      } else {
        console.log(`You have no rewards to retrieve`);
      }
      console.log(`\n`);
      console.groupEnd();
    }
    console.groupEnd();
  } else {
    console.log(`You have no rewards to retrieve`);
  }
};
