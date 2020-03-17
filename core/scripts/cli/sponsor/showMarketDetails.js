const inquirer = require("inquirer");
const getDefaultAccount = require("../wallet/getDefaultAccount");
const create = require("./create");
const redeem = require("./redeem");

const showMarketDetails = async (web3, artifacts, emp) => {
  const { fromWei } = web3.utils;
  const sponsorAddress = await getDefaultAccount(web3);
  const collateral = await emp.getCollateral(sponsorAddress);

  const backAction = "Back";
  if (collateral.toString() === "0") {
    // Sponsor doesn't have a position.
    const prompt = {
      type: "list",
      name: "choice",
      message: "You are not currently a sponsor",
      choices: [{ name: "Sponsor new position" }, { name: backAction }]
    };
    const input = await inquirer.prompt(prompt);
    if (input["choice"] !== backAction) {
      await create(web3, artifacts, emp);
    }
  } else {
    const position = await emp.positions(sponsorAddress);
    console.log(
      "Your position has Tokens:",
      fromWei(position.tokensOutstanding.toString()),
      "Collateral:",
      fromWei(collateral.toString())
    );

    const actions = {
      back: "Back",
      create: "Borrow more tokens",
      redeem: "Repay tokens"
    };
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
      case actions.back:
        return;
      default:
        console.log("unimplemented state");
    }
  }
};

module.exports = showMarketDetails;
