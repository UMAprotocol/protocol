const inquirer = require("inquirer");
const getDefaultAccount = require("../wallet/getDefaultAccount");
const { LiquidationStatesEnum } = require("../../../../common/Enums.js");
const { getIsWeth, unwrapToEth } = require("./currencyUtils");
const { submitTransaction } = require("./transactionUtils");

const viewLiquidationDetails = async (web3, artifacts, emp, liquidation, id) => {
  const ExpandedERC20 = artifacts.require("ExpandedERC20");

  const sponsorAddress = await getDefaultAccount(web3);
  const display = `Liquidated at epoch time ${liquidation.liquidationTime} by ${liquidation.liquidator}`;
  const backChoice = "Back";
  const withdrawAction = "Withdraw";
  choices = [{ name: backChoice }];
  // Check if the sponsor can withdraw by seeing if `withdrawLiquidation` reverts.
  try {
    await emp.withdrawLiquidation.call(id, sponsorAddress);
    choices.push({ name: withdrawAction });
  } catch (err) {
    // Withdraw wouldn't work so it shouldn't be a valid option.
  }
  const input = await inquirer.prompt({
    type: "list",
    name: "choice",
    message: display,
    choices
  });
  if (input["choice"] === backChoice) {
    return;
  }
  const confirmation = await inquirer.prompt({
    type: "confirm",
    message: "Withdrawing collateral. Continue?",
    name: "confirm"
  });
  if (confirmation["confirm"]) {
    const collateralCurrency = await ExpandedERC20.at(await emp.collateralCurrency());
    const isWeth = await getIsWeth(web3, artifacts, collateralCurrency);

    const withdrawalAmount = await emp.withdrawLiquidation.call(id, sponsorAddress);
    await submitTransaction(web3, async () => await emp.withdrawLiquidation(id, sponsorAddress), "Withdrawing");
    if (isWeth) {
      await unwrapToEth(web3, artifacts, emp, withdrawalAmount.toString());
    }
  }
};

module.exports = viewLiquidationDetails;
