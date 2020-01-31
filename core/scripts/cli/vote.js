const inquirer = require("inquirer");

const ACTIONS = ["info", "commit", "reveal", "rewards", "help", "back"];

const vote = async () => {
  const prompts = [
    {
      type: "list",
      name: "voteTopMenu",
      message: "Voting actions",
      choices: ACTIONS
    }
  ];

  return await inquirer.prompt(prompts);
};

module.exports = async function(web3, artifacts) {
  const Voting = artifacts.require("Voting");
  const voting = await Voting.deployed();
  try {
    const inputs = await vote();
    switch (inputs["voteTopMenu"]) {
      case ACTIONS[0]:
        const pendingRequests = await voting.getPendingRequests();
        const roundId = await voting.getCurrentRoundId();
        console.group(`\n** Your voting status **`);
        console.log(`- Current round ID: ${roundId.toNumber()}`);
        console.log(`- Pending price requests:`, pendingRequests);
        console.groupEnd();
        break;
      case "back":
        return;
      default:
        console.log("unimplemented state");
    }
  } catch (err) {
    console.log(err);
  }
  return;
};
