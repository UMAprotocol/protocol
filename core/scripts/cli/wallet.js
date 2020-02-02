const inquirer = require("inquirer");

const ACTIONS = ["info", "init", "restore", "help", "back"];

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
  const { fromWei } = web3.utils;
  const { getAccounts, getBalance } = web3.eth;

  const accounts = await getAccounts();
  try {
    const inputs = (await wallet())["walletTopMenu"];
    switch (inputs) {
      // Display default wallet information for user
      case ACTIONS[0]:
        const address = accounts[0];
        let balance = await getBalance(address);
        console.group(`\n** Ethereum Wallet Info **`);
        console.log(`- Address: ${address}`);
        console.log(`- Balance: ${fromWei(balance)} ETH`);
        console.groupEnd();
        break;
      // Create a new default wallet
      // - Detect if there is a wallet stored in ~/.uma
      // - If yes, ask whether to use this one (needs a name) or create a new one
      // - Using newly created wallet, add to web3.accounts
      // - If don't want to create a new one then use default web3 wallet
      // - If no default web3 wallet then throw error
      // TODO: Handle MetaMask somehow
      case "back":
        return;
      default:
        console.log("unimplemented state");
    }
  } catch (err) {
    console.log(err);
  }
  return;
};
