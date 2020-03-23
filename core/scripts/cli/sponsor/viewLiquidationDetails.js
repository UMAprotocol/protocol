const inquirer = require("inquirer");
const getDefaultAccount = require("../wallet/getDefaultAccount");
const { LiquidationStatesEnum } = require("../../../../common/Enums.js");
const { unwrapToEth } = require("./currencyUtils");
const { submitTransaction } = require("./transactionUtils");

const viewLiquidationDetails = async (web3, artifacts, emp, liquidation, id) => {
  const sponsorAddress = await getDefaultAccount(web3);
  const display = "Liquidated at epoch time " + liquidation.liquidationTime + " by " + liquidation.liquidator;
  const backChoice = "Back";
  const withdrawAction = "Withdraw";
  choices = [{ name: backChoice }];
  if (liquidation.state === LiquidationStatesEnum.DISPUTE_SUCCEEDED) {
    // TODO: Need to detect whether you can withdraw or not?
    choices.push({ name: withdrawAction });
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
    const withdrawalAmount = await emp.withdrawLiquidation.call(id, sponsorAddress);
    await submitTransaction(web3, async () => await emp.withdrawLiquidation(id, sponsorAddress), "Withdrawing");
    await unwrapToEth(web3, artifacts, emp, withdrawalAmount.toString());
  }
};

module.exports = viewLiquidationDetails;
