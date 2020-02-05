const inquirer = require("inquirer");
const style = require("./textStyle");

// Voting module helpers
const displayStatus = require("./voting/displayStatus");
const displayRequests = require("./voting/displayRequests");

const ACTIONS = {
  info: "Info",
  requests: "Pending Commit or Reveal Requests",
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
        await displayStatus(web3, artifacts);
        break;

      // REQUESTS: Detailed breakdown of commit or reveal requests depending on the current round phase
      case ACTIONS.requests:
        await displayRequests(web3, artifacts);
        break;

      // VOTE: Allow user to 'select' price requests to submit votes on

      // HELP
      case ACTIONS.help:
        console.group(`${style.bgCyan(`Voting actions`)}:`);
        console.log(`${style.bgCyan(ACTIONS.info)}: displays information about the current voting round`);
        console.log(
          `${style.bgCyan(
            ACTIONS.requests
          )}: displays a more detailed break down of pending commit or reveal requests. You can commit votes during the "Commit" phase on pending price requests, or reveal votes during the "Reveal" phase.`
        );
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
