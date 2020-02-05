const inquirer = require("inquirer");
const style = require("./textStyle");

// Voting module helpers
const displayStatus = require("./voting/displayStatus");
const displayRequests = require("./voting/displayRequests");
const commitVotes = require("./voting/commitVotes");
const revealVotes = require("./voting/revealVotes");

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
    const Voting = artifacts.require("Voting");
    const voting = await Voting.deployed();

    const inputs = (await vote())["voteTopMenu"];
    switch (inputs) {
      // INFO: Round ID, phase, inflation & GAT rates, and quick breakdown of pending price requests/vote reveals
      case ACTIONS.info:
        await displayStatus(web3, voting);
        break;

      // REQUESTS: Detailed breakdown of commit or reveal requests depending on the current round phase
      case ACTIONS.requests:
        await displayRequests(web3, voting);
        break;

      // COMMIT: Allow user to 'select' price requests to submit votes on
      case ACTIONS.commit:
        await commitVotes(web3, voting);
        break;

      // REVEAL: Allow user to 'select' price requests to reveal votes for
      case ACTIONS.reveal:
        await revealVotes(web3, voting);
        break;

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
