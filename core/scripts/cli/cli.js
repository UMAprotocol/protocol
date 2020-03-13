const inquirer = require("inquirer");

const sponsor = require("./sponsor");
const style = require("./textStyle");
const vote = require("./vote");
const wallet = require("./wallet");
const admin = require("./admin.js");

const ACTIONS = {
  wallet: "Wallet",
  vote: "Vote",
  sponsor: "Sponsor",
  admin: "Admin",
  help: "Help",
  exit: "Exit"
};

async function topMenu() {
  const prompts = [
    {
      type: "list",
      name: "topMenu",
      message: "Top level menu. What do you want to do?",
      choices: Object.values(ACTIONS)
    }
  ];

  const result = await inquirer.prompt(prompts);
  return result["topMenu"];
}

/**
 * Top-level menu of CLI tool, and main node JS entry point.
 */
async function run() {
  // TODO: Should do a check here to detect if contracts are deployed,
  // as wallet, vote, and admin modules all assume they are deployed
  let run = true;
  while (run) {
    const choice = await topMenu();
    switch (choice) {
      case ACTIONS.wallet:
        await wallet(web3, artifacts);
        break;
      case ACTIONS.vote:
        await vote(web3, artifacts);
        break;
      case ACTIONS.sponsor:
        await sponsor(web3, artifacts);
        break;
      case ACTIONS.admin:
        await admin(artifacts, web3);
        break;
      // HELP
      case ACTIONS.help:
        console.group(`${style.help("Welcome to the UMA Voting Tool")}:`);
        console.log(
          `${style.help(
            ACTIONS.wallet
          )}: Displays your token balances and provides functionality for generating new voting accounts.`
        );
        console.log(
          `${style.help(
            ACTIONS.vote
          )}: Review pending price requests that you can vote on (as well as other helpful information about the current voting round). You can also commit votes, reveal votes, and retrieve rewards.`
        );
        console.log(`${style.help(ACTIONS.admin)}: View pending UMA Admin proposals.`);
        console.groupEnd();
        break;
      case ACTIONS.exit:
        run = false;
        break;
      default:
        console.log("unimplemented state");
        break;
    }
  }
}

module.exports = async function(cb) {
  try {
    await run();
  } catch (err) {
    cb(err);
  }
  cb();
};
