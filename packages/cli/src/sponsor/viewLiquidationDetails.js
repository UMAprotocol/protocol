const inquirer = require("inquirer");
const getDefaultAccount = require("../wallet/getDefaultAccount");
const { getIsWeth, unwrapToEth, getCurrencySymbol } = require("./currencyUtils");
const { submitTransaction } = require("./transactionUtils");
const { LiquidationStatesEnum } = require("@uma/common");
const { liquidationStateToDisplay } = require("./liquidationUtils");
const { interfaceName } = require("@uma/common");

/**
 * @notice Display details about all liquidation events for this sponsor.
 */
const viewLiquidationDetailsMenu = async (web3, artifacts, emp, liquidationEvents) => {
  const { fromWei } = web3.utils;

  const backChoice = "Back";
  const choices = [{ name: backChoice }];

  // Get liquidation data from contract and compare them against all liquidation events
  // for the sponsor.
  const sponsorAddress = await getDefaultAccount(web3);
  const liquidationStructs = await emp.getLiquidations(sponsorAddress);
  for (let i = 0; i < liquidationEvents.length; i++) {
    const liquidation = liquidationEvents[i];

    // Fetch liquidation data from contract using ID in event.
    const liquidationId = liquidation.args.liquidationId;
    const liquidatedTokens = liquidation.args.tokensOutstanding;
    const liquidatedCollateral = liquidation.args.liquidatedCollateral;
    const lockedCollateral = liquidation.args.lockedCollateral;
    const liquidationData = liquidationStructs[liquidationId];
    const liquidationState = liquidationData.state;

    const display = `ID #${liquidationId}: Liquidated tokens: ${fromWei(
      liquidatedTokens.toString()
    )}, Locked collateral: ${fromWei(
      lockedCollateral.toString()
    )}, Liquidated collateral (including withdrawal requests) : ${fromWei(
      liquidatedCollateral.toString()
    )}, Status: ${liquidationStateToDisplay(liquidationState)}`;
    choices.push({ name: display, value: liquidationId });
  }
  const input = await inquirer.prompt({
    type: "list",
    name: "choice",
    message:
      "Pick a liquidation. You can withdraw rewards from liquidations marked 'PENDING DISPUTE' or 'SUCCESSFULLY DISPUTED' if the oracle has resolved a price and that price makes the dispute successful.",
    choices
  });
  if (input["choice"] === backChoice) {
    return;
  }

  await viewWithdrawRewardsMenu(web3, artifacts, emp, liquidationStructs[input["choice"]], input["choice"]);
};

/**
 * @notice Display menu of options to withdraw rewards from eligible liquidations.
 */
const viewWithdrawRewardsMenu = async (web3, artifacts, emp, liquidation, id) => {
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
    // This will only succeed if the state is PENDING_DISPUTE and a price has resolved that will make the dispute succeed.
    await emp.withdrawLiquidation.call(id, sponsorAddress);
    choices.push({ name: withdrawAction });
  } catch (err) {
    // Withdraw wouldn't work so it shouldn't be a valid option. Let's print out a detailed response to the user to indicate why
    // `withdraw` will fail.

    // The sponsor can only withdraw rewards from a successfully disputed liquidation.
    if (liquidation.state === LiquidationStatesEnum.PRE_DISPUTE) {
      // If liquidation state is PRE_DISPUTE and `withdrawLiquidation` fails, then the liquidation has either expired
      // or is pre-expiry. Only a liquidator can withdraw from an expired liquidation.

      const currentTime = web3.utils.toBN(await emp.getCurrentTime());
      const liquidationExpirationTime = web3.utils
        .toBN(liquidation.liquidationTime)
        .add(web3.utils.toBN(await emp.liquidationLiveness()));
      if (liquidationExpirationTime.lte(currentTime)) {
        console.log("Cannot withdraw rewards from a liquidation that has expired");
      } else {
        console.log("Cannot withdraw rewards from a liquidation that is pre-expiry and has not been disputed");
      }
    } else if (liquidation.state === LiquidationStatesEnum.PENDING_DISPUTE) {
      // If the liquidation state is PENDING_DISPUTE and `withdrawLiquidation` fails, then it indicates that either
      // a price has not resolved yet, or a price has resolved that indicates that the dispute will FAIL.

      // Fetch oracle price and use it to customize error message.
      const Finder = artifacts.require("Finder");
      let finder = await Finder.deployed();
      const OracleInterface = artifacts.require("OracleInterface");
      let oracle = await OracleInterface.at(
        await finder.getImplementationAddress(web3.utils.utf8ToHex(interfaceName.Oracle))
      );
      // Need to explicitly pass {from:emp.address} in these EMP view-only calls because they will revert due to their
      // `onlyRegisteredContract` modifier. However, web3 will not throw an error as expected even if the method
      // reverts on-chain. More details [here](https://github.com/ethereum/web3.js/issues/1903) and
      // [here](https://github.com/ethereum/solidity/issues/4840).
      if (await oracle.hasPrice(await emp.priceIdentifier(), liquidation.liquidationTime, { from: emp.address })) {
        const resolvedPrice = await oracle.getPrice(await emp.priceIdentifier(), liquidation.liquidationTime, {
          from: emp.address
        });
        console.log(
          `Liquidation has been disputed and a price of ${web3.utils.fromWei(
            resolvedPrice.toString()
          )} has been resolved. This will cause the dispute to fail and there will not be any rewards to withdraw`
        );
      } else {
        console.log("Liquidation has been disputed and it is currently awaiting a price resolution");
      }
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

module.exports = {
  viewLiquidationDetailsMenu,
  viewWithdrawRewardsMenu
};
