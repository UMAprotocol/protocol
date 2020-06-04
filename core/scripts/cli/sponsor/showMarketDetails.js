const inquirer = require("inquirer");
const winston = require("winston");
const getDefaultAccount = require("../wallet/getDefaultAccount");
const create = require("./create");
const redeem = require("./redeem");
const withdraw = require("./withdraw");
const deposit = require("./deposit");
const transfer = require("./transfer");
const { viewLiquidationDetailsMenu } = require("./viewLiquidationDetails");
const { getLiquidationEvents } = require("./liquidationUtils");
const { getIsWeth, getCurrencySymbol } = require("./currencyUtils.js");
const { createReferencePriceFeedForEmp } = require("../../../../financial-templates-lib/price-feed/CreatePriceFeed.js");
const { Networker } = require("../../../../financial-templates-lib/price-feed/Networker.js");
const { computeCollateralizationRatio } = require("../../../../common/EmpUtils.js");
const { createFormatFunction } = require("../../../../common/FormattingUtils.js");

const showMarketDetails = async (web3, artifacts, emp) => {
  const ExpandedERC20 = artifacts.require("ExpandedERC20");
  const { fromWei, toBN } = web3.utils;
  // const sponsorAddress = await getDefaultAccount(web3);
  const sponsorAddress = "0x367f62f022e0c8236d664fba35b594591270dafb";
  let collateral = (await emp.getCollateral(sponsorAddress)).toString();
  const collateralCurrency = await ExpandedERC20.at(await emp.collateralCurrency());
  const syntheticCurrency = await ExpandedERC20.at(await emp.tokenCurrency());
  const collateralSymbol = await getCurrencySymbol(web3, artifacts, collateralCurrency);
  const syntheticSymbol = await getCurrencySymbol(web3, artifacts, syntheticCurrency);

  // This function should only be called if the sponsor has an existing position.
  const printSponsorSummary = async sponsorAddress => {
    console.group("Summary of your position:");

    if (collateral !== "0") {
      const position = await emp.positions(sponsorAddress);
      const isWeth = await getIsWeth(web3, artifacts, collateralCurrency);
      const collateralSymbol = await getCurrencySymbol(web3, artifacts, collateralCurrency);

      // TODO: potentially generalize this for use elsewhere in the CLI tool.
      const getCollateralizationRatio = async () => {
        let priceFeed;
        try {
          priceFeed = await createReferencePriceFeedForEmp(
            winston.createLogger({ silent: true }),
            web3,
            new Networker(),
            () => Math.floor(Date.now() / 1000),
            emp.address
          );
        } catch (error) {
          // Ignore error
        }

        if (!priceFeed) {
          return "Unknown";
        }

        await priceFeed.update();
        const collateralizationRatio = await computeCollateralizationRatio(
          web3,
          priceFeed.getCurrentPrice(),
          toBN(collateral.toString()),
          toBN(position.tokensOutstanding.toString())
        );
        const format = createFormatFunction(web3, 2, 4, false);
        return format(collateralizationRatio.muln(100)) + "%";
      };

      const getDateStringReadable = contractTime => {
        return new Date(Number(contractTime.toString() * 1000)).toString();
      };

      console.table({
        "Current contract time": getDateStringReadable(await emp.getCurrentTime()),
        "Tokens you've minted": fromWei(position.tokensOutstanding.toString()),
        "Deposited collateral": fromWei(collateral) + (isWeth ? " ETH" : " " + collateralSymbol),
        "Collateralization ratio": await getCollateralizationRatio(),
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
  switch (input) {
    case actions.viewLiquidations:
      await viewLiquidationDetailsMenu(web3, artifacts, emp, liquidationEvents);
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
};

module.exports = showMarketDetails;
