const fs = require("fs");
const inquirer = require("inquirer");
const setDefaultAccountForWallet = require("./setDefaultAccountForWallet");
const style = require("../textStyle");

module.exports = async (web3, accountDataFile) => {
  // Check if backup file exists
  try {
    fs.statSync(`${accountDataFile}.backup`);
    const confirm = await inquirer.prompt({
      type: "confirm",
      name: "restoreAccount",
      message: `Type 'y' to make account.seed.backup your default account. This will also set your default account as your backup account.`,
      default: false
    });
    if (confirm["restoreAccount"]) {
      // Save old wallet to backup and create new wallet
      try {
        fs.copyFileSync(`${accountDataFile}.backup`, `${accountDataFile}.temp`);
        try {
          fs.statSync(`${accountDataFile}`);
          fs.copyFileSync(`${accountDataFile}`, `${accountDataFile}.backup`);
        } catch (err) {
          if (err.code === "ENOENT") {
            // If wallet.seed does not exist (but wallet.seed.backup does exist),
            // then just delete wallet.backup since we've already copied it to wallet.temp
            fs.unlinkSync(`${accountDataFile}.backup`);
          }
        }
        fs.copyFileSync(`${accountDataFile}.temp`, `${accountDataFile}`);
        fs.unlinkSync(`${accountDataFile}.temp`);
        const restoredAccount = JSON.parse(fs.readFileSync(accountDataFile));
        console.log(`Restored account with public key: ${style.bgRed(restoredAccount.address)}`);
        setDefaultAccountForWallet(web3, restoredAccount);
      } catch (err) {
        console.error(err);
        console.error(`Failed to restore backup account file`);
      }
    }
  } catch (err) {
    if (err.code === "ENOENT") {
      console.log(`Account backup does not exist`);
    }
  }
};
