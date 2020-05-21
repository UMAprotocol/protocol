const inquirer = require("inquirer");
const getDefaultAccount = require("../wallet/getDefaultAccount");
const { getIsWeth, unwrapToEth, getCurrencySymbol } = require("./currencyUtils");
const { submitTransaction } = require("./transactionUtils");
const { LiquidationStatesEnum } = require("../../../../common/Enums");

const viewLiquidationDetails = async (web3, artifacts, emp, liquidation, id) => {
  // If liquidation `sponsor` property is empty, then either the sponsor's liquidation rewards have been withdrawn or the
  // liquidation data has been deleted following an expired liquidation or a failed dispute.
  // Therefore, this should catch all liquidations with state == `UNINITIALIZED` following a deletion of the liquidation struct.
  if (liquidation.sponsor === "0x0000000000000000000000000000000000000000") {
    console.log("There are no rewards to withdraw from this liquidation");
    return;
  }

  // Now we know that the liquidation still has rewards to be withdrawn, but we need to check if the sponsor is eligible
  // to receive rewards.
  const ExpandedERC20 = artifacts.require("ExpandedERC20");
  const sponsorAddress = await getDefaultAccount(web3);
  const liquidationTimeReadable = new Date(Number(liquidation.liquidationTime.toString()) * 1000);
  const display = `Liquidated at time ${liquidationTimeReadable} by ${liquidation.liquidator}`;
  const backChoice = "Back";
  // Sponsors can withdraw rewards only if a liquidation has been disputed successfully.
  const withdrawAction = "Dispute succeeded; withdraw rewards";
  choices = [{ name: backChoice }];

  // Check if the sponsor can withdraw by seeing if `withdrawLiquidation` reverts.
  try {
    await emp.withdrawLiquidation.call(id, sponsorAddress);
    choices.push({ name: withdrawAction });
  } catch (err) {
    // Withdraw wouldn't work so it shouldn't be a valid option. Let's print out a detailed response to the user to indicate why
    // `withdraw` will fail.

    // The sponsor can only withdraw rewards from a successfully disputed liquidation.
    if (liquidation.state === LiquidationStatesEnum.PRE_DISPUTE) {
      // If liquidation state is PRE_DISPUTE and `withdrawLiquidation` fails, then the liquidation has either expired
      // or is pre-expiry. Only a liquidator can withdraw from an expired liquidation.
      console.log(
        "Cannot withdraw rewards from a liquidation that is pre-expiry and has not been disputed, or has already expired"
      );
    } else if (liquidation.state === LiquidationStatesEnum.PENDING_DISPUTE) {
      // If the liquidation state is PENDING_DISPUTE and `withdrawLiquidation` fails, then it indicates that either
      // a price has not resolved yet, or a price has resolved that indicates that the dispute will FAIL.
      console.log(
        "Liquidation has been disputed, but it is currently pending dispute and awaiting a price resolution, or a price has already resolved and the dispute will fail"
      );
    } else if (liquidation.state === LiquidationStatesEnum.DISPUTE_SUCCEEDED) {
      // If the liquidation state is DISPUTE_SUCCEEDED and `withdrawLiquidation` fails, then the sponsor has already
      // withdrawn their rewards.
      console.log("You have already withdrawn rewards from this successfully disputed liquidation");
    } else {
      // The code should never reach here.
      // If the code reaches here, then the liquidation data has not been deleted yet and the sponsor cannot withdraw rewards.
      // The liquidation state must be in the DISPUTE_FAILED state, which should not be possible because the liquidation state
      // should pass from PENDING_DISPUTE --> DISPUTE_FAILED and then DISPUTE_FAILED --> UNINITIALIZED following the liquidator calling
      // `withdrawRewards`.
      console.log(
        "Cannot withdraw rewards. Liquidation has been unsuccessfully disputed and the liquidation has executed."
      );
    }

    // The liquidation state should never be UNINITIALIZED here because we already checked if the `liquidation.sponsor` is the zero address.
    // It is impossible for the state to be UNINITIALIZE and the sponsor to not be the zero address.
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
    message: "Withdrawing collateral from successfully disputed liquidation. Continue?",
    name: "confirm"
  });
  if (confirmation["confirm"]) {
    const collateralCurrency = await ExpandedERC20.at(await emp.collateralCurrency());
    const collateralSymbol = await getCurrencySymbol(web3, artifacts, collateralCurrency);
    const isWeth = await getIsWeth(web3, artifacts, collateralCurrency);

    const withdrawalAmount = await emp.withdrawLiquidation.call(id, sponsorAddress);
    await submitTransaction(
      web3,
      async () => await emp.withdrawLiquidation(id, sponsorAddress),
      `Withdrawing ${web3.utils.fromWei(withdrawalAmount.toString())} ${collateralSymbol}`
    );
    if (isWeth) {
      await unwrapToEth(web3, artifacts, emp, withdrawalAmount.toString());
    }
  }
};

module.exports = viewLiquidationDetails;
