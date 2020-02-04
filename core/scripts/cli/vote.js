const inquirer = require("inquirer");
const style = require("./textStyle");

const ACTIONS = {
  info: "Info",
  commit: "Commit",
  reveal: "Reveal",
  rewards: "Rewards",
  help: "Help",
  back: "Back"
};

const vote = async () => {
  const prompts = [
    {
      type: "list",
      name: "voteTopMenu",
      message: "Voting actions",
      choices: Object.values(ACTIONS)
    }
  ];

  return await inquirer.prompt(prompts);
};

module.exports = async function(web3, artifacts) {
  const Voting = artifacts.require("Voting");
  const voting = await Voting.deployed();
  try {
    const inputs = (await vote())["voteTopMenu"];
    switch (inputs) {
      case ACTIONS.info:
        style.spinnerReadingContracts.start();
        const pendingRequests = await voting.getPendingRequests();
        const roundId = await voting.getCurrentRoundId();
        const roundPhase = await voting.getVotePhase();
        const roundStats = await voting.rounds(roundId);
        style.spinnerReadingContracts.stop();
        console.group(`${style.bgMagenta(`\n** Your voting status **`)}`);
        console.log(`${style.bgMagenta(`- Current round ID`)}: ${roundId.toString()}`);
        // TODO: Display these as ordered table intuitvely
        console.log(`${style.bgMagenta(`- Pending price requests`)}:`, pendingRequests);
        console.log(
          `${style.bgMagenta(`- Current round phase`)}: ${roundPhase.toString() === "0" ? "Commit" : "Reveal"}`
        );
        console.log(`${style.bgMagenta(`- Round Inflation percentage`)}: ${roundStats.inflationRate.toString()}`);
        console.log(`${style.bgMagenta(`- Round GAT percentage`)}: ${roundStats.gatPercentage.toString()}`);
        console.log(`\n`);
        console.groupEnd();
        break;
      case ACTIONS.back:
        return;
      default:
        console.log("unimplemented state");
    }
  } catch (err) {
    console.log(err);
  }
  return;
};
