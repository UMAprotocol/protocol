const inquirer = require("inquirer");
const style = require("./textStyle");
const displayStatus = require("./voting/displayStatus");
const commitVotes = require("./voting/commitVotes");
const revealVotes = require("./voting/revealVotes");
const retrieveRewards = require("./voting/retrieveRewards");
const getTwoKeyContract = require("./wallet/getTwoKeyContract");

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
    const votingContract = await Voting.deployed();
    const designatedVotingContract = await getTwoKeyContract(web3, artifacts);

    const inputs = (await vote())["voteTopMenu"];
    switch (inputs) {
      // INFO: Round ID, phase, inflation & GAT rates, and quick breakdown of pending price requests/vote reveals
      case ACTIONS.info:
        await displayStatus(web3, votingContract, designatedVotingContract);
        break;

      // COMMIT: Allow user to 'select' price requests to submit votes on
      case ACTIONS.commit:
        await commitVotes(web3, votingContract, designatedVotingContract);
        break;

      // REVEAL: Allow user to 'select' price requests to reveal votes for
      case ACTIONS.reveal:
        await revealVotes(web3, votingContract, designatedVotingContract);
        break;

      // REWARDS: Allow user to 'select' resolved price requests to retrieve rewards for
      case ACTIONS.rewards:
        await retrieveRewards(web3, votingContract, designatedVotingContract);
        break;

      // HELP
      case ACTIONS.help:
        console.group(`${style.help("Voting actions")}:`);
        console.log(
          `${style.help(
            ACTIONS.info
          )}: Displays information about the current voting round including pending price requests to commit or reveal votes for, and rewards available. Also displays two key designated voting contract information if the user has set it up properly.`
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
        console.log(
          `${style.help(
            ACTIONS.rewards
          )}: Prompts user to select resolved votes to retrieve rewards for. This might not work perfectly if you are using a Metamask provider.`
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

module.exports = votingMenu;
