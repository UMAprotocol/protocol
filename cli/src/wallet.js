const inquirer = require("inquirer");
const createNewAccount = require("./wallet/createNewAccount");
const readDefaultAccount = require("./wallet/readDefaultAccountInfo");
const style = require("./textStyle");

const ACTIONS = {
  info: "Info",
  generate: "Generate Account",
  help: "Help",
  back: "Back"
};

const wallet = async () => {
  const prompts = [
    {
      type: "list",
      name: "walletTopMenu",
      message: "UMA wallet actions",
      choices: Object.values(ACTIONS)
    }
  ];

  return await inquirer.prompt(prompts);
};

/**
 * Menu for Wallet subactions of CLI
 */
const walletMenu = async function(web3, artifacts) {
  try {
    const inputs = (await wallet())["walletTopMenu"];
    switch (inputs) {
      // INFO: Display default account information for user
      case ACTIONS.info:
        await readDefaultAccount(web3, artifacts);
        break;

      // GENERATE: Create a new account for user
      case ACTIONS.generate:
        await createNewAccount(web3);
        break;

      // HELP
      case ACTIONS.help:
        console.group(`${style.help("Wallet actions")}:`);
        console.log(
          `${style.help(
            ACTIONS.info
          )}: Displays balance information for your default account from which you will send UMA-related transactions`
        );
        console.log(
          `${style.help(
            ACTIONS.generate
          )}: Create and display credentials for a new Ethereum account. If you want to make this your default signing account for UMA-related transactions then you can import it into Metamask or save it into your environment variable "MNEMONIC".`
        );
        console.groupEnd();
        break;

      // BACK
      case ACTIONS.back:
        return;

      default:
        console.log("unimplemented state");
    }
  } catch (err) {
    console.error('Unknown "wallet" error:', err);
  }
  return;
};

module.exports = walletMenu;
