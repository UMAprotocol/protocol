const inquirer = require("inquirer");
const style = require("./textStyle");
const displayStatus = require("./voting/displayStatus");
const commitVotes = require("./voting/commitVotes");
const revealVotes = require("./voting/revealVotes");
const retrieveRewards = require("./voting/retrieveRewards");

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

/**
 * Menu for Voting subactions of CLI
 */
const votingMenu = async function(web3, artifacts) {
  try {
    const Voting = artifacts.require("Voting");
    const voting = await Voting.deployed();

    const inputs = (await vote())["voteTopMenu"];
    switch (inputs) {
      // INFO: Round ID, phase, inflation & GAT rates, and quick breakdown of pending price requests/vote reveals
      case ACTIONS.info:
        await displayStatus(web3, voting);
        break;

      // COMMIT: Allow user to 'select' price requests to submit votes on
      case ACTIONS.commit:
        await commitVotes(web3, voting);
        break;

      // REVEAL: Allow user to 'select' price requests to reveal votes for
      case ACTIONS.reveal:
        await revealVotes(web3, voting);
        break;

      // REWARDS: Allow user to 'select' resolved price requests to retrieve rewards for
      case ACTIONS.rewards:
        await retrieveRewards(web3, voting);
        break;

      // HELP
      case ACTIONS.help:
        console.group(`${style.help(`Voting actions`)}:`);
        console.log(
          `${style.help(
            ACTIONS.info
          )}: Displays information about the current voting round including pending price requests to commit or reveal votes for, and rewards available.`
        );
        console.log(
          `${style.help(
            ACTIONS.commit
          )}: Prompts user to select batch of price requests to vote for. Only possible during the Commit phase.`
        );
        console.log(
          `${style.help(
            ACTIONS.reveal
          )}: Prompts user to select batch of votes to reveal. Only possible during the Reveal phase.`
        );
        console.log(`${style.help(ACTIONS.rewards)}: Prompts user to select resolved votes to retrieve rewards for.`);
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

module.exports = votingMenu;
