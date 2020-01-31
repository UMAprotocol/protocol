const inquirer = require("inquirer");

const vote = require("./vote");
const wallet = require("./wallet");
const { decodeGovernorProposal, decodeAllActiveGovernorProposals } = require("./decode.js");

async function topMenu() {
  const prompts = [
    {
      type: "list",
      name: "topMenu",
      message: "Top level menu. What do you want to do?",
      choices: ["Wallet", "Vote", "View admin proposals", "help", "exit"]
    }
  ];

  const result = await inquirer.prompt(prompts);
  return result["topMenu"];
};

async function run() {
  let run = true;
  while (run) {
    const choice = await topMenu();
    switch (choice) {
      case "Wallet":
        await wallet(web3);
        break;
      case "Vote":
        await vote(web3, artifacts);
        break;
      case "View admin proposals":
        break;
      case "exit":
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
