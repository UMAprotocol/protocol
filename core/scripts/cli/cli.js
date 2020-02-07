const inquirer = require("inquirer");

const vote = require("./vote");
const wallet = require("./wallet");
const admin = require("./admin.js");

const ACTIONS = {
  wallet: "Wallet",
  vote: "Vote",
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

async function run() {
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
      case ACTIONS.admin:
        await admin(artifacts, web3);
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
