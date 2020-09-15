const inquirer = require("inquirer");
const getDefaultAccount = require("../wallet/getDefaultAccount");
const create = require("./create");
const redeem = require("./redeem");
const withdraw = require("./withdraw");
const deposit = require("./deposit");
const transfer = require("./transfer");
const { viewLiquidationDetailsMenu } = require("./viewLiquidationDetails");
const { getLiquidationEvents } = require("./liquidationUtils");
const { getIsWeth, getCurrencySymbol } = require("./currencyUtils.js");
const { getCollateralizationRatio } = require("./marketUtils.js");
const { createFormatFunction } = require("@uma/common");

const showMarketDetails = async (web3, artifacts, emp) => {
  const ExpandedERC20 = artifacts.require("ExpandedERC20");
  const { fromWei, toBN } = web3.utils;
  const sponsorAddress = await getDefaultAccount(web3);
  const collateralCurrency = await ExpandedERC20.at(await emp.collateralCurrency());
  const syntheticCurrency = await ExpandedERC20.at(await emp.tokenCurrency());
  const collateralSymbol = await getCurrencySymbol(web3, artifacts, collateralCurrency);
  const syntheticSymbol = await getCurrencySymbol(web3, artifacts, syntheticCurrency);

  // This function should only be called if the sponsor has an existing position.
  const printSponsorSummary = async sponsorAddress => {
    console.group("Summary of your position:");

    const collateral = (await emp.getCollateral(sponsorAddress)).toString();

    if (collateral !== "0") {
      const position = await emp.positions(sponsorAddress);
      const isWeth = await getIsWeth(web3, artifacts, collateralCurrency);
      const collateralSymbol = await getCurrencySymbol(web3, artifacts, collateralCurrency);
      const collateralRequirement = await emp.collateralRequirement();
      const format = createFormatFunction(web3, 2, 4);

      const getDateStringReadable = contractTime => {
        return new Date(Number(contractTime.toString() * 1000)).toString();
      };

      const collateralizationRatioFieldString = `Collateralization ratio (min ${format(
        collateralRequirement.muln(100)
      )}%)`;
      console.table({
        "Current contract time": getDateStringReadable(await emp.getCurrentTime()),
        "Tokens you've minted": fromWei(position.tokensOutstanding.toString()),
        "Deposited collateral": fromWei(collateral) + (isWeth ? " ETH" : " " + collateralSymbol),
        [collateralizationRatioFieldString]: await getCollateralizationRatio(
          web3,
          emp.address,
          collateral,
          position.tokensOutstanding
        ),
        "Collateral pending/available to withdraw": fromWei(position.withdrawalRequestAmount.toString()),
        "Pending transfer request": position.transferPositionRequestPassTimestamp.toString() !== "0" ? "Yes" : "No"
      });
    }

    // For convenience, show user's token balances.
    const collateralBalance = await collateralCurrency.balanceOf(sponsorAddress);
    console.log(`- Sponsor address: ${sponsorAddress}`);
    console.log(`- Current collateral balance: ${fromWei(collateralBalance.toString())} ${collateralSymbol}`);
    const syntheticBalance = await syntheticCurrency.balanceOf(sponsorAddress);
    console.log(`- Current synthetic balance: ${fromWei(syntheticBalance.toString())} ${syntheticSymbol}`);

    console.groupEnd();
    return;
  };

  /**
   * BUILD SPONSOR MENU OF OPTIONS TO CREATE OR MODIFY THEIR POSITION:
   */
  await printSponsorSummary(sponsorAddress);

  let actions = {};
  let message = "What would you like to do?";

  const collateral = (await emp.getCollateral(sponsorAddress)).toString();
  if (collateral === "0") {
    // Sponsor doesn't have a position.
    actions = {
      ...actions,
      create: "Sponsor new position"
    };
    message = "You are not currently a sponsor. What would you like to do?";
  } else {
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

  // If sponsor has ever been liquidated, then show liquidation details and allow them to withdraw rewards
  // if possible.
  const liquidationEvents = await getLiquidationEvents(emp, sponsorAddress);
  if (liquidationEvents.length > 0) {
    actions = {
      ...actions,
      viewLiquidations: "View your liquidations"
    };
  }

  actions = {
    ...actions,
    back: "Back"
  };

  /**
   * DISPLAY INQUIRER MENU:
   */
  const prompt = {
    type: "list",
    name: "choice",
    message,
    choices: Object.values(actions)
  };
  const input = (await inquirer.prompt(prompt))["choice"];

  let shouldShowPositionInfo = false;
  switch (input) {
    case actions.viewLiquidations:
      await viewLiquidationDetailsMenu(web3, artifacts, emp, liquidationEvents);
      break;
    case actions.create:
      shouldShowPositionInfo = await create(web3, artifacts, emp, collateral !== "0");
      break;
    case actions.redeem:
      shouldShowPositionInfo = await redeem(web3, artifacts, emp);
      break;
    case actions.withdraw:
      shouldShowPositionInfo = await withdraw(web3, artifacts, emp);
      break;
    case actions.deposit:
      shouldShowPositionInfo = await deposit(web3, artifacts, emp);
      break;
    case actions.transfer:
      shouldShowPositionInfo = await transfer(web3, emp);
      break;
    case actions.back:
      return;
    default:
      console.log("unimplemented state");
  }

  if (shouldShowPositionInfo) {
    await printSponsorSummary(sponsorAddress);
  }
};

module.exports = showMarketDetails;
