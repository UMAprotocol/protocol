const inquirer = require("inquirer");
const style = require("../textStyle");

module.exports = async web3 => {
  const confirm = await inquirer.prompt({
    type: "confirm",
    name: "createNewAccount",
    message: style.bgYellow(
      "We will never store your private keys, so please ensure that your computer is secure and you keep it a secret. Anybody who knows your private key controls your account! Type 'y' to confirm your understanding."
    ),
    default: false
  });
  if (confirm["createNewAccount"]) {
    const newAccount = web3.eth.accounts.create();
    console.group(style.bgGreen("\n** Generated a New Ethereum Account **"));
    console.log(`${style.bgGreen("- Public Key")}: ${newAccount.address}`);
    console.log(`${style.bgGreen("- Private Key")}: ${newAccount.privateKey}`);
    console.log(
      `${style.bgGreen(
        '- If you want to use this account as your default account when sending UMA transactions, then exit the CLI tool, set your "PRIVATE_KEY" environment variable to the above secret, and restart the CLI via "uma --network ropsten_privatekey", replacing "ropsten" with the network of your choice'
      )}`
    );
    console.log("\n");
    console.groupEnd();
  }
};
