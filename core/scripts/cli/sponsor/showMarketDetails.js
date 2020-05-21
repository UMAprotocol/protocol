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
  let collateral = (await emp.getCollateral(sponsorAddress)).toString();
  const collateralCurrency = await ExpandedERC20.at(await emp.collateralCurrency());
  const syntheticCurrency = await ExpandedERC20.at(await emp.tokenCurrency());
  const collateralSymbol = await getCurrencySymbol(web3, artifacts, collateralCurrency);
  const syntheticSymbol = await getCurrencySymbol(web3, artifacts, syntheticCurrency);

  // This function should only be called if the sponsor has an existing position.
  const printSponsorSummary = async sponsorAddress => {
    const collateral = (await emp.getCollateral(sponsorAddress)).toString();
    if (collateral === "0") {
      throw "Sponsor does not have a position; cannot print a sponsor summar";
    } else {
      const position = await emp.positions(sponsorAddress);
      const isWeth = await getIsWeth(web3, artifacts, collateralCurrency);
      const collateralSymbol = await getCurrencySymbol(web3, artifacts, collateralCurrency);

      const getDateStringReadable = contractTime => {
        return new Date(Number(contractTime.toString() * 1000)).toString();
      };

      console.table({
        "Current contract time": getDateStringReadable(await emp.getCurrentTime()),
        "Tokens you've minted": fromWei(position.tokensOutstanding.toString()),
        "Deposited collateral": fromWei(collateral) + (isWeth ? " ETH" : " " + collateralSymbol),
        "Collateral pending/available to withdraw": fromWei(position.withdrawalRequestAmount.toString()),
        "Pending transfer request": position.transferPositionRequestPassTimestamp.toString() !== "0" ? "Yes" : "No"
      });
    }
  };

  // Read liquidations from past events, since they will be deleted from the contract state after
  // all of their rewards are withdrawn.
  const liquidationEvents = await emp.getPastEvents("LiquidationCreated", {
    fromBlock: 0,
    filter: { sponsor: sponsorAddress }
  });
  const liquidationStateToDisplay = state => {
    switch (state) {
      case LiquidationStatesEnum.DISPUTE_SUCCEEDED:
        return "SUCCESSFULLY DISPUTED LIQUIDATION";
      case LiquidationStatesEnum.PRE_DISPUTE:
        return "PENDING LIQUIDATION";
      case LiquidationStatesEnum.PENDING_DISPUTE:
        return "PENDING DISPUTED LIQUIDATION";
      default:
        // All liquidation rewards have been withdrawn.
        return "LIQUIDATED AND/OR NO REWARDS TO WITHDRAW";
    }
  };
  const viewLiquidations = async () => {
    const backChoice = "Back";
    const choices = [{ name: backChoice }];
    const liquidationStructs = await emp.getLiquidations(sponsorAddress);
    for (let i = 0; i < liquidationEvents.length; i++) {
      const liquidation = liquidationEvents[i];

      // Fetch liquidation data from contract using ID in event.
      const liquidationId = liquidation.args.liquidationId;
      const liquidationData = liquidationStructs[liquidationId];
      const liquidationState = liquidationData.state;

      const display = `#${liquidationId}: Liquidated tokens: ${fromWei(
        liquidation.args.tokensOutstanding.toString()
      )}, Locked collateral: ${fromWei(
        liquidation.args.lockedCollateral.toString()
      )}, Liquidated collateral (including withdrawal requests) : ${fromWei(
        liquidation.args.liquidatedCollateral.toString()
      )}, Status: ${liquidationStateToDisplay(liquidationState)}`;
      choices.push({ name: display, value: liquidationId });
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
    await viewLiquidationDetails(web3, artifacts, emp, liquidationStructs[input["choice"]], input["choice"]);
  };

  let actions = {
    back: "Back"
  };
  if (liquidationEvents.length > 0) {
    actions = {
      ...actions,
      viewLiquidations: "View your liquidations"
    };
  }
  let message = "What would you like to do?";

  // For convenience, show user's token balances.
  const collateralBalance = await collateralCurrency.balanceOf(sponsorAddress);
  console.log(`Current collateral balance: ${fromWei(collateralBalance.toString())} ${collateralSymbol}`);
  const syntheticBalance = await syntheticCurrency.balanceOf(sponsorAddress);
  console.log(`Current synthetic balance: ${fromWei(syntheticBalance.toString())} ${syntheticSymbol}`);

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

    const hasPendingWithdrawal = position.withdrawalRequestPassTimestamp.toString() !== "0";
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
      await create(web3, artifacts, emp, collateral !== "0");
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

  // Print updated position summary if applicable.
  collateral = (await emp.getCollateral(sponsorAddress)).toString();
  if (collateral !== "0") {
    console.log("\nYour updated position:");
    await printSponsorSummary(sponsorAddress);
  }
};

module.exports = showMarketDetails;
