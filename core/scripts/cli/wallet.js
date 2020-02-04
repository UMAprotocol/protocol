// TODO:
// Encrypt account data files
// Show UMA token balance in wallet-info
// Allow user to change directory in which wallets are stored
// Allow more than one wallet backups
// Connect to MetaMask

const inquirer = require("inquirer");
const os = require("os");

// Wallet module helpers
const createNewAccount = require("./wallet/createNewAccount");
const createWalletDirectory = require("./wallet/createWalletDirectory");
const loadSavedAccount = require("./wallet/loadSavedAccount");
const restoreBackupAccount = require("./wallet/swapDefaultAndBackupAccounts");
const readDefaultAccount = require("./wallet/readDefaultAccountInfo");
const recoverAccount = require("./wallet/recoverAccount");
const style = require("./textStyle");

const ACTIONS = ["info", "init", "restore-backup", "recover", "help", "back"];

const wallet = async () => {
  const prompts = [
    {
      type: "list",
      name: "walletTopMenu",
      message: "UMA wallet actions",
      choices: ACTIONS
    }
  ];

  return await inquirer.prompt(prompts);
};

module.exports = async function(web3) {
  // Get saved .uma directory for user (if it exists) and copy default account into web3.accounts.wallet
  // @dev: Get home directory in platform agnostic way, src=https://stackoverflow.com/questions/9080085/node-js-find-home-directory-in-platform-agnostic-way
  const homedir = os.homedir();
  const umaDirectory = `${homedir}/.uma`;
  const walletDirectory = createWalletDirectory(umaDirectory);
  const accountDataFile = `${walletDirectory}/account.seed`;
  loadSavedAccount(web3, accountDataFile);

  try {
    const inputs = (await wallet())["walletTopMenu"];
    switch (inputs) {
      // INFO: Display default account information for user
      case ACTIONS[0]:
        await readDefaultAccount(web3);
        break;

      // INIT: Create a new account for user
      case ACTIONS[1]:
        await createNewAccount(web3, accountDataFile);
        break;

      // RESTORE: Replace account backup with default account
      case ACTIONS[2]:
        await restoreBackupAccount(web3, accountDataFile);
        break;

      // RECOVER: Allow user to enter a private key for their desired default account
      case ACTIONS[3]:
        await recoverAccount(web3, accountDataFile);
        break;

      // HELP
      case "help":
        console.group(`${style.bgCyan(`Wallet actions`)}:`);
        console.log(
          `${style.bgCyan(
            `- info`
          )}: displays balance information for your default account, stored in ${accountDataFile}`
        );
        console.log(
          `${style.bgCyan(
            `- init`
          )}: create a new default account, backs up previous default account in the same directory`
        );
        console.log(
          `${style.bgCyan(`- restore-backup`)}: restores your account backup to your default (and backs up the default)`
        );
        console.log(`${style.bgCyan(`- recover`)}: recover a account from a private key and set as your default`);
        console.groupEnd();
        break;

      // BACK
      case "back":
        return;

      default:
        console.log("unimplemented state");
    }
  } catch (err) {
    console.error(`Unknown "wallet" error:`, err);
  }
  return;
};
