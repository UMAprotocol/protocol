const fs = require("fs");
const inquirer = require("inquirer");
const setDefaultAccountForWallet = require("./setDefaultAccountForWallet");
const style = require("../textStyle");
const saveAccount = require("./saveAccount");

module.exports = async (web3, newAccountPath) => {
  const secretInput = await inquirer.prompt({
    type: "password",
    name: "privKey",
    message: `Please enter your Ethereum private key (${style.bgYellow(
      `WARNING: This will become your new default account and we will backup your previous default account`
    )}):`,
    mask: true
  });
  try {
    let inputPrivKey;
    if (!secretInput["privKey"].startsWith("0x")) {
      inputPrivKey = `0x${secretInput["privKey"]}`;
    } else {
      inputPrivKey = secretInput["privKey"];
    }

    const recoveredAccount = web3.eth.accounts.privateKeyToAccount(inputPrivKey);
    try {
      fs.statSync(newAccountPath);
      // User has an existing account, back it up
      try {
        fs.copyFileSync(newAccountPath, `${newAccountPath}.backup`);
      } catch (err) {
        console.error(`Failed to backup existing account file`, err);
      }
    } catch (err) {
      if (err.code === "ENOENT") {
        // User does not have an existing account, nothing to backup
      } else {
        console.error(`Unknown error reading file ${newAccountPath}`);
      }
    }
    saveAccount(newAccountPath, recoveredAccount);
    setDefaultAccountForWallet(web3, recoveredAccount);
  } catch (err) {
    console.error(`Failed to recover wallet from provided private key`);
  }
};
