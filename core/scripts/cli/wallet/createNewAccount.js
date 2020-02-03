const fs = require("fs");
const inquirer = require("inquirer");
const setDefaultAccountForWallet = require("./setDefaultAccountForWallet");

const createAndSaveAccount = (web3, newAccountPath) => {
  const newAccount = web3.eth.accounts.create();
  try {
    fs.writeFileSync(newAccountPath, JSON.stringify(newAccount));
    console.log(`Saved new Ethereum account to ${newAccountPath} with public key: ${newAccount.address}`);
    return newAccount;
  } catch (err) {
    console.error(`Failed to save new Ethereum wallet to  ${newAccountPath}`, err);
  }
};

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
        const newAccount = createAndSaveAccount(web3, newAccountPath);
        setDefaultAccountForWallet(web3, newAccount);
      } catch (err) {
        console.error(`Failed to backup existing account file`);
      }
    }
  } catch (err) {
    if (err.code === "ENOENT") {
      // User does not have an account, create a new one
      const newAccount = createAndSaveAccount(web3, newAccountPath);
      setDefaultAccountForWallet(web3, newAccount);
    } else {
      console.error(err);
    }
  }
};
