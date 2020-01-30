const inquirer = require("inquirer");

const vote = async () => {
  const prompts = [
    {
      type: "list",
      name: "voteTopMenu",
      message: "Voting actions",
      choices: ["list pending price requests and vote", "commit specific vote", "reveal votes", "get round ID", "back"]
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
      case "list pending price requests and vote":
        const pendingRequests = await voting.getPendingRequests();
        console.log(pendingRequests);
        break;
      case "get round ID":
        const roundId = await voting.getCurrentRoundId();
        console.log(roundId.toNumber());
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
