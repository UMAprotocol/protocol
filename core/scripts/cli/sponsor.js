const inquirer = require("inquirer");
const listMarkets = require("./sponsor/listMarkets");

const ACTIONS = {
  listMarkets: "Show all Markets",
  back: "Back"
};

const sponsor = async () => {
  const prompts = [
    {
      type: "list",
      name: "sponsorTopMenu",
      message: "Sponsor top level menu. What would you like to do?",
      choices: Object.values(ACTIONS)
    }
  ];
  return await inquirer.prompt(prompts);
};

const sponsorMenu = async (web3, artifacts) => {
  try {
    const inputs = (await sponsor())["sponsorTopMenu"];
    switch (inputs) {
      case ACTIONS.listMarkets:
        await listMarkets(web3, artifacts);
        break;
      case ACTIONS.back:
        return;
      default:
        console.log("unimplemented state");
    }
  } catch (err) {
    console.log(err);
  }
};

module.exports = sponsorMenu;
