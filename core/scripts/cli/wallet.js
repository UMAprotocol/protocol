const inquirer = require("inquirer");

const wallet = async () => {
  const prompts = [
    {
      type: "list",
      name: "walletTopMenu",
      message: "Wallet actions",
      choices: ["view wallet address", "wallet balance", "transfer tokens", "back"]
    }
  ];

  answers = await inquirer.prompt(prompts);
  return answers;
};

module.exports = async function(web3) {
  const accounts = await web3.eth.getAccounts();
  try {
    const inputs = await wallet();
    switch (inputs["walletTopMenu"]) {
      case "view wallet address":
        console.log(accounts[0]);
        break;
      case "wallet balance":
        let balance = await web3.eth.getBalance(accounts[0]);
        console.log(web3.utils.fromWei(balance), "Eth");
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
