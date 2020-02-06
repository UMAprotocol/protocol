const inquirer = require("inquirer");
const style = require("../textStyle");

module.exports = async web3 => {
  const confirm = await inquirer.prompt({
    type: "confirm",
    name: "createNewAccount",
    message: style.bgRed(
      `We will never store your private keys, so please ensure that your computer is secure and you keep it a secret. Anybody who knows your private key controls your account! Type 'y' to confirm your understanding.`
    ),
    default: false
  });
  if (confirm["createNewAccount"]) {
    const newAccount = web3.eth.accounts.create();
    console.group(style.bgGreen(`\n** Generated a New Ethereum Account **`));
    console.log(`${style.bgGreen(`- Public Key`)}: ${newAccount.address}`);
    console.log(`${style.bgGreen(`- Private Key`)}: ${newAccount.privateKey}`);
    console.log(
      `${style.bgGreen(
        `- Instructions for using your new account`
      )}: If you want to use this account as your default account when sending UMA transactions, then exit the CLI tool, set your "PRIVATE_KEY" environment variable to the above secret (i.e. "export PRIVATE_KEY=0x348ce564d427a3311b6536bbcff9390d69395b06ed6c486954e971d960fe8709"), and restart the CLI via "uma --network mainnet_privatekey", replacing "mainnet" with the network of your choice`
    );
    console.log(`\n`);
    console.groupEnd();
  }
};
