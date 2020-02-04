const fs = require("fs");
const inquirer = require("inquirer");
const setDefaultAccountForWallet = require("./setDefaultAccountForWallet");
const saveAccount = require("./saveAccount");

module.exports = async (web3, newAccountPath) => {
  // Check if account file exists
  try {
    fs.statSync(newAccountPath);
    // User already has an account
    const confirm = await inquirer.prompt({
      type: "confirm",
      name: "createNewAccount",
      message: `You have previously created an Ethereum account, do you want to create another one? Type 'y' to backup your previous account which will be renamed as account.seed.backup`,
      default: false
    });
    if (confirm["createNewAccount"]) {
      // Save old wallet to backup and create new wallet
      try {
        fs.copyFileSync(newAccountPath, `${newAccountPath}.backup`);
        const newAccount = web3.eth.accounts.create();
        saveAccount(newAccountPath, newAccount);
        setDefaultAccountForWallet(web3, newAccount);
      } catch (err) {
        console.error(`Failed to save new account and backup existing account file`);
      }
    }
  } catch (err) {
    if (err.code === "ENOENT") {
      // User does not have an account, create a new one
      const newAccount = web3.eth.accounts.create();
      saveAccount(newAccountPath, newAccount);
      setDefaultAccountForWallet(web3, newAccount);
    } else {
      console.error(`Unknown error reading file ${newAccountPath}`);
    }
  }
};
