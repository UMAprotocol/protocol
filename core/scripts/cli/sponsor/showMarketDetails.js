const inquirer = require("inquirer");
const getDefaultAccount = require("../wallet/getDefaultAccount");
const create = require("./create");
const redeem = require("./redeem");
const withdraw = require("./withdraw");
const deposit = require("./deposit");
const transfer = require("./transfer");
const viewLiquidationDetails = require("./viewLiquidationDetails");
const { LiquidationStatesEnum } = require("../../../../common/Enums.js");
const { getIsWeth, getCurrencySymbol } = require("./currencyUtils.js");

const showMarketDetails = async (web3, artifacts, emp) => {
  const ExpandedERC20 = artifacts.require("ExpandedERC20");
  const { fromWei } = web3.utils;
  const sponsorAddress = await getDefaultAccount(web3);
  const collateral = (await emp.getCollateral(sponsorAddress)).toString();

  const printSponsorSummary = async sponsorAddress => {
    const collateral = (await emp.getCollateral(sponsorAddress)).toString();
    if (collateral === "0") {
      console.log("You are not currently a sponsor");
    } else {
      const position = await emp.positions(sponsorAddress);
      const collateralCurrency = await ExpandedERC20.at(await emp.collateralCurrency());
      const isWeth = await getIsWeth(web3, artifacts, collateralCurrency);
      const collateralSymbol = await getCurrencySymbol(web3, artifacts, collateralCurrency);

      console.table({
        "Tokens you've minted": fromWei(position.tokensOutstanding.toString()),
        "Deposited collateral": fromWei(collateral) + (isWeth ? " ETH" : " " + collateralSymbol),
        "Collateral pending/available to withdraw": fromWei(position.withdrawalRequestAmount.toString()),
        "Pending transfer request": position.transferPositionRequestPassTimestamp.toString() !== "0" ? "Yes" : "No"
      });
    }
  };

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
      const display = `Minted: ${fromWei(liquidation.tokensOutstanding.toString())} Collateral: ${fromWei(
        liquidation.lockedCollateral.toString()
      )} Status: ${liquidationStateToDisplay(liquidation.state)}`;
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
  let message = "What would you like to do?";
  if (collateral === "0") {
    // Sponsor doesn't have a position.
    actions = {
      ...actions,
      create: "Sponsor new position"
    };
    message = "You are not currently a sponsor. What would you like to do?";
  } else {
    console.log("Summary of your position:");
    await printSponsorSummary(sponsorAddress);
    const position = await emp.positions(sponsorAddress);

    const hasPendingWithdrawal = position.requestPassTimestamp.toString() !== "0";
    if (hasPendingWithdrawal) {
      console.log(
        "Because you have a pending withdrawal, other contract functions are blocked. Either execute or cancel your withdrawal. You can still request to transfer your position to a new sponsor address and cancel this request, but you cannot execute the transfer until the withdrawal request is processed."
      );
      actions = {
        ...actions,
        withdraw: "Manage your withdrawal request",
        transfer: "Manage your transfer request"
      };
    } else {
      actions = {
        ...actions,
        create: "Mint more tokens",
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
    message,
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
      await transfer(web3, emp);
      break;
    case actions.back:
      return;
    default:
      console.log("unimplemented state");
  }
  console.log("\nYour updated position:");
  await printSponsorSummary(sponsorAddress);
};

module.exports = showMarketDetails;
