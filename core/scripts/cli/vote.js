const inquirer = require("inquirer");
const style = require("./textStyle");

const ACTIONS = {
  info: "info",
  commit: "commit",
  reveal: "reveal",
  rewards: "rewards",
  help: "help",
  back: "back"
};

const vote = async () => {
  const prompts = [
    {
      type: "list",
      name: "voteTopMenu",
      message: "Voting actions",
      choices: Object.keys(ACTIONS)
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
        style.spinnerReadingContracts.stop();
        console.group(`\n** Your voting status **`);
        console.log(`- Current round ID: ${roundId.toNumber()}`);
        console.log(`- Pending price requests:`, pendingRequests);
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
