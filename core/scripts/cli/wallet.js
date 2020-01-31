const inquirer = require("inquirer");

const ACTIONS = ["info", "restore", "help", "back"];

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
      case ACTIONS[0]:
        const address = accounts[0];
        let balance = await getBalance(address);
        console.group(`\n** Ethereum Wallet Info **`);
        console.log(`- Address: ${address}`);
        console.log(`- Balance: ${fromWei(balance)} ETH`);
        console.groupEnd();
        break;
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
