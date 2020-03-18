const inquirer = require("inquirer");
const getDefaultAccount = require("../wallet/getDefaultAccount");
const create = require("./create");
const redeem = require("./redeem");
const withdraw = require("./withdraw");
const deposit = require("./deposit");
const transfer = require("./transfer");

const showMarketDetails = async (web3, artifacts, emp) => {
  const { fromWei } = web3.utils;
  const sponsorAddress = await getDefaultAccount(web3);
  const collateral = (await emp.getCollateral(sponsorAddress)).toString();

  let actions;
  if (collateral === "0") {
    // Sponsor doesn't have a position.
    console.log("You are not currently a sponsor");
    actions = {
      back: "Back",
      create: "Sponsor new position"
    };
  } else {
    const position = await emp.positions(sponsorAddress);
    console.log("You have:");
    console.log(
      "Position: " +
        fromWei(collateral) +
        " WETH backing " +
        fromWei(position.tokensOutstanding.toString()) +
        " synthetic tokens"
    );

    actions = {
      back: "Back",
      create: "Borrow more tokens",
      redeem: "Repay tokens",
      withdraw: "Withdraw collateral",
      deposit: "Deposit collateral",
      transfer: "Transfer position to new owner"
    };
  }
  const prompt = {
    type: "list",
    name: "choice",
    message: "What would you like to do?",
    choices: Object.values(actions)
  };
  const input = (await inquirer.prompt(prompt))["choice"];
  switch (input) {
    case actions.create:
      await create(web3, artifacts, emp);
      break;
    case actions.redeem:
      await redeem(web3, artifacts, emp);
      break;
    case actions.withdraw:
      await withdraw(web3, artifacts, emp);
      break;
    case actions.deposit:
      await deposit(web3, artifacts, emp);
      break;
    case actions.transfer:
      await transfer(web3, artifacts, emp);
      break;
    case actions.back:
      return;
    default:
      console.log("unimplemented state");
  }
};

module.exports = showMarketDetails;
