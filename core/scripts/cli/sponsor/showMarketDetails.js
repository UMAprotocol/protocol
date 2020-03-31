const inquirer = require("inquirer");
const getDefaultAccount = require("../wallet/getDefaultAccount");
const create = require("./create");
const redeem = require("./redeem");
const withdraw = require("./withdraw");
const deposit = require("./deposit");
const transfer = require("./transfer");
const viewLiquidationDetails = require("./viewLiquidationDetails");
const { LiquidationStatesEnum } = require("../../../../common/Enums.js");

const showMarketDetails = async (web3, artifacts, emp) => {
  const { fromWei } = web3.utils;
  const sponsorAddress = await getDefaultAccount(web3);
  const collateral = (await emp.getCollateral(sponsorAddress)).toString();
  const liquidations = await emp.getLiquidations(sponsorAddress);
  const liquidationStateToDisplay = state => {
    switch (state) {
      case LiquidationStatesEnum.DISPUTE_SUCCEEDED:
        return "LIQUIDATION FAILED (ACTION REQUIRED)";
      case LiquidationStatesEnum.DISPUTE_FAILED:
        return "LIQUIDATED";
      default:
        return "PENDING";
    }
  };
  const viewLiquidations = async () => {
    const backChoice = "Back";
    const choices = [{ name: backChoice }];
    for (let i = 0; i < liquidations.length; i++) {
      const liquidation = liquidations[i];
      const display =
        "Borrowed: " +
        fromWei(liquidation.tokensOutstanding) +
        " Collateral: " +
        fromWei(liquidation.lockedCollateral) +
        " Status: " +
        liquidationStateToDisplay(liquidation.state);
      choices.push({ name: display, value: i });
    }
    const input = await inquirer.prompt({
      type: "list",
      name: "choice",
      message: "Pick a liquidation",
      choices
    });
    if (input["choice"] === backChoice) {
      return;
    }
    await viewLiquidationDetails(web3, artifacts, emp, liquidations[input["choice"]], input["choice"]);
  };

  let actions = {
    back: "Back"
  };
  if (liquidations.length > 0) {
    actions = {
      ...actions,
      viewLiquidations: "View your liquidations"
    };
  }
  if (collateral === "0") {
    // Sponsor doesn't have a position.
    console.log("You are not currently a sponsor");
    actions = {
      ...actions,
      create: "Sponsor new position"
    };
  } else {
    const position = await emp.positions(sponsorAddress);

    console.table({
      "Tokens you've borrowed": fromWei(position.tokensOutstanding.toString()),
      "Deposited collateral": fromWei(collateral) + " WETH",
      "Collateral pending/available to withdraw": fromWei(position.withdrawalRequestAmount.toString())
    });

    const hasPendingWithdrawal = position.requestPassTimestamp.toString() !== "0";
    if (hasPendingWithdrawal) {
      console.log(
        "Because you have a pending withdrawal, other contract functions are blocked. Either execute or cancel your withdrawal."
      );
      actions = {
        ...actions,
        withdraw: "Withdraw collateral"
      };
    } else {
      actions = {
        ...actions,
        create: "Borrow more tokens",
        redeem: "Repay tokens",
        withdraw: "Withdraw collateral",
        deposit: "Deposit collateral",
        transfer: "Transfer position to new owner"
      };
    }
  }
  const prompt = {
    type: "list",
    name: "choice",
    message: "What would you like to do?",
    choices: Object.values(actions)
  };
  const input = (await inquirer.prompt(prompt))["choice"];
  switch (input) {
    case actions.viewLiquidations:
      await viewLiquidations(web3, artifacts, emp);
      break;
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
