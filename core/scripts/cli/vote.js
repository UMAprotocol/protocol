const inquirer = require("inquirer");
const style = require("./textStyle");

// Voting module helpers
const displayStatus = require("./voting/displayStatus");
const displayPriceRequests = require("./voting/displayPriceRequests");

const ACTIONS = {
  info: "Info",
  priceRequests: "Price Request Details",
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
  try {
    const inputs = (await vote())["voteTopMenu"];
    switch (inputs) {
      // INFO: Round ID, phase, inflation & GAT rates, and quick breakdown of pending price requests/vote reveals
      case ACTIONS.info:
        await displayStatus(artifacts);
        break;

      // PRICE REQUESTS: Detailed breakdown of price requests
      case ACTIONS.priceRequests:
        await displayPriceRequests(web3, artifacts);
        break;

      // VOTE: Allow user to 'select' price requests to submit votes on

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
