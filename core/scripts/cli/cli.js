<<<<<<< HEAD
const { decodeGovernorProposal, decodeAllActiveGovernorProposals } = require("./decode.js");

const cli = async function(callback) {
  try {
    console.log("You have started the UMA CLI!");
  } catch (e) {
    callback(e);
  }
=======
const inquirer = require("inquirer");
const vote = require("./vote");
const wallet = require("./wallet");
>>>>>>> master

const collectInputs = async () => {
  const prompts = [
    {
      type: "list",
      name: "topMenu",
      message: "Top level menu. What do you want to do?",
      choices: ["wallet", "vote", "claim rewards", "DVM system status", "help", "exit"]
    }
  ];

  return await inquirer.prompt(prompts);
};

async function run() {
  let run = true;
  while (run) {
    const inputs = await collectInputs();
    switch (inputs["topMenu"]) {
      case "wallet":
        await wallet(web3);
        break;
      case "vote":
        await vote(web3, artifacts);
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
    console.log(err);
  }
  cb();
};
