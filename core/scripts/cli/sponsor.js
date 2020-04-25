const inquirer = require("inquirer");
const listMarkets = require("./sponsor/listMarkets");
const listExpiredMarkets = require("./sponsor/listExpiredMarkets");

const ACTIONS = {
  listMarkets: "List live markets",
  listExpiredMarkets: "List expired markets",
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
  const inputs = (await sponsor())["sponsorTopMenu"];
  switch (inputs) {
    case ACTIONS.listMarkets:
      await listMarkets(web3, artifacts);
      break;
    case ACTIONS.listExpiredMarkets:
      await listExpiredMarkets(web3, artifacts);
      break;
    case ACTIONS.back:
      return;
    default:
      console.log("unimplemented state");
  }
};

module.exports = sponsorMenu;
