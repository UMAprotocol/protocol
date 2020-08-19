const inquirer = require("inquirer");
const getDefaultAccount = require("../wallet/getDefaultAccount");
const { unwrapToEth, getIsWeth, getCurrencySymbol } = require("./currencyUtils.js");
const { submitTransaction } = require("./transactionUtils");
const { getCollateralizationRatio } = require("./marketUtils.js");

const withdraw = async (web3, artifacts, emp) => {
  const ExpandedERC20 = artifacts.require("ExpandedERC20");
  const { fromWei, toWei, toBN } = web3.utils;
  const sponsorAddress = await getDefaultAccount(web3);
  const collateral = (await emp.getCollateral(sponsorAddress)).toString();
  const position = await emp.positions(sponsorAddress);
  const collateralCurrency = await ExpandedERC20.at(await emp.collateralCurrency());
  const isWeth = await getIsWeth(web3, artifacts, collateralCurrency);
  const collateralSymbol = await getCurrencySymbol(web3, artifacts, collateralCurrency);
  const requiredCollateralSymbol = isWeth ? "ETH" : collateralSymbol;

  const scalingFactor = toBN(toWei("1"));

  // Cancel pending withdrawal.
  const cancelWithdrawal = async () => {
    const confirmation = await inquirer.prompt({
      type: "confirm",
      message: "Continue?",
      default: false,
      name: "confirm"
    });
    if (confirmation["confirm"]) {
      await submitTransaction(web3, async () => await emp.cancelWithdrawal(), "Cancelling pending withdrawal");

      // Cancellation was sent.
      return true;
    }

    // No cancellation was sent.
    return false;
  };

  // Execute pending withdrawal.
  const executeWithdrawal = async () => {
    const confirmation = await inquirer.prompt({
      type: "confirm",
      message: "Would you like to execute this withdrawal?",
      name: "confirm"
    });
    if (confirmation["confirm"]) {
      let totalTransactions = isWeth ? 2 : 1;
      let transactionNum = 1;

      // Simulate withdrawal to confirm exactly how much collateral you will receive back.
      const exactCollateral = await emp.withdrawPassedRequest.call();
      await submitTransaction(
        web3,
        async () => await emp.withdrawPassedRequest(),
        `Withdrawing ${collateralSymbol}`,
        transactionNum,
        totalTransactions
      );
      transactionNum++;
      if (isWeth) {
        await unwrapToEth(web3, artifacts, emp, exactCollateral, transactionNum, totalTransactions);
      }

      // Withdrawal was executed.
      return true;
    }

    // Withdrawal was not executed.
    return false;
  };

  // First check if user has a withdrawal request pending.
  const withdrawalRequestPassedTimestamp = position.withdrawalRequestPassTimestamp;
  if (withdrawalRequestPassedTimestamp.toString() !== "0") {
    const withdrawRequestAmount = position.withdrawalRequestAmount.toString();
    const currentTime = await emp.getCurrentTime();

    // Calculate future collateralization ratio if withdrawal request were to go through.
    const collateralizationRatio = await getCollateralizationRatio(
      web3,
      emp.address,
      toBN(collateral).sub(toBN(withdrawRequestAmount)),
      position.tokensOutstanding
    );

    // Get current contract time and withdrawal request expiration time.
    const currentTimeReadable = new Date(Number(currentTime.toString()) * 1000);
    const expirationTimeReadable = new Date(Number(withdrawalRequestPassedTimestamp.toString()) * 1000);

    // Withdraw request is still pending. User can cancel withdraw.
    if (toBN(withdrawalRequestPassedTimestamp.toString()).gt(toBN(currentTime.toString()))) {
      console.log(
        `You have a withdrawal request for approximately ${fromWei(
          withdrawRequestAmount
        )} ${requiredCollateralSymbol} that is pending until ${expirationTimeReadable}.`
      );
      console.log(`The current contract time is ${currentTimeReadable}.`);
      console.log(
        `Hypothetical collateralization ratio if the withdrawal request were to go through: ${collateralizationRatio}`
      );
      const prompt = {
        type: "list",
        name: "choice",
        message: "What would you like to do?",
        choices: ["Back", "Cancel Pending Withdrawal"]
      };
      const input = (await inquirer.prompt(prompt))["choice"];
      switch (input) {
        case "Cancel Pending Withdrawal":
          return await cancelWithdrawal();
        case "Back":
          // No transaction was sent.
          return false;
        default:
          console.log("unimplemented state");
      }
    }
    // Withdraw request has passed, user can withdraw or cancel.
    else {
      console.log(
        `Your withdrawal request for approximately ${fromWei(
          withdrawRequestAmount
        )} ${requiredCollateralSymbol} has been ready since ${expirationTimeReadable}.`
      );
      console.log(`The current contract time is ${currentTimeReadable}.`);
      console.log(
        `Hypothetical collateralization ratio once the withdrawal request executes: ${collateralizationRatio}`
      );
      const prompt = {
        type: "list",
        name: "choice",
        message: "What would you like to do?",
        choices: ["Back", "Cancel Pending Withdrawal", "Execute Pending Withdrawal"]
      };
      const input = (await inquirer.prompt(prompt))["choice"];
      switch (input) {
        case "Execute Pending Withdrawal":
          return await executeWithdrawal();
        case "Cancel Pending Withdrawal":
          return await cancelWithdrawal();
        case "Back":
          // No transaction was sent.
          return false;
        default:
          console.log("unimplemented state");
      }
    }
  } else {
    const withdrawalLiveness = await emp.withdrawalLiveness();
    const withdrawalLivenessInMinutes = toBN(withdrawalLiveness.toString())
      .div(toBN(60))
      .toString();
    // Calculate current collateralization ratio.
    const collateralizationRatio = await getCollateralizationRatio(
      web3,
      emp.address,
      collateral,
      position.tokensOutstanding
    );
    console.log(`Current collateralization ratio: ${collateralizationRatio}`);

    // Calculate GCR.
    const totalPositionCollateral = toBN((await emp.totalPositionCollateral()).rawValue.toString());
    const totalTokensOutstanding = toBN((await emp.totalTokensOutstanding()).toString());
    const gcr = totalPositionCollateral.mul(scalingFactor).divRound(totalTokensOutstanding);

    // Given current collateralization ratio and GCR, calculate maximum amount of tokens
    // user can withdraw instantly.
    const minCollateralAboveGcr = toBN(position.tokensOutstanding.toString())
      .mul(gcr)
      .divRound(scalingFactor);
    const excessCollateral = toBN(collateral).sub(minCollateralAboveGcr);
    const maxInstantWithdrawal = excessCollateral.gt(toBN(0)) ? excessCollateral : toBN(0);
    console.log(
      `You must request an amount to withdraw. The request takes ${withdrawalLivenessInMinutes} minutes to process.`
    );
    // TODO: Use price feed to calculate what's the maximum withdrawal amount that'll meet the collateralization
    // requirement. Display that to the user here.

    // Prompt user to enter withdrawal amount
    const input = await inquirer.prompt({
      name: "numCollateral",
      message: `How much ${requiredCollateralSymbol} to withdraw?`,
      validate: value =>
        (value > 0 && toBN(toWei(value)).lte(toBN(collateral))) ||
        `You can only withdraw up to ${fromWei(collateral)} ${requiredCollateralSymbol}`
    });
    const tokensToWithdraw = toBN(toWei(input["numCollateral"]));
    const newCollateralizationRatio = await getCollateralizationRatio(
      web3,
      emp.address,
      toBN(collateral).sub(tokensToWithdraw),
      position.tokensOutstanding
    );

    // Requested withdrawal amount can be processed instantly, call `withdraw()`
    if (tokensToWithdraw.lte(maxInstantWithdrawal)) {
      console.log(
        `Your withdrawal of approximately ${fromWei(
          tokensToWithdraw
        )} ${requiredCollateralSymbol} will process instantly`
      );
      console.log(
        `Hypothetical collateralization ratio if you choose to execute this withdrawal: ${newCollateralizationRatio}`
      );
      const confirmation = await inquirer.prompt({
        type: "confirm",
        message: "Continue?",
        name: "confirm"
      });
      if (confirmation["confirm"]) {
        let totalTransactions = isWeth ? 2 : 1;
        let transactionNum = 1;

        // Simulate withdrawal to confirm exactly how much collateral you will receive back.
        const exactCollateral = await emp.withdraw.call({ rawValue: tokensToWithdraw.toString() });
        await submitTransaction(
          web3,
          async () => await emp.withdraw({ rawValue: tokensToWithdraw.toString() }),
          `Withdrawing ${collateralSymbol}`,
          transactionNum,
          totalTransactions
        );
        transactionNum++;
        if (isWeth) {
          await unwrapToEth(web3, artifacts, emp, exactCollateral, transactionNum, totalTransactions);
        }

        // Withdrawal was sent.
        return true;
      }
    }
    // Requested withdrawal amount cannot be processed instantly, call `requestWithdrawal()`
    else {
      console.log(
        `Come back in ${withdrawalLivenessInMinutes} minutes to execute your withdrawal of ${fromWei(
          tokensToWithdraw
        )} ${requiredCollateralSymbol}`
      );
      console.log(`Hypothetical collateralization ratio if this withdrawal is executed: ${newCollateralizationRatio}`);
      const confirmation = await inquirer.prompt({
        type: "confirm",
        message: "Continue?",
        name: "confirm"
      });
      if (confirmation["confirm"]) {
        await submitTransaction(
          web3,
          async () => await emp.requestWithdrawal({ rawValue: tokensToWithdraw.toString() }),
          "Requesting withdrawal"
        );
        console.log(
          `Withdrawal requested. Come back in ${withdrawalLivenessInMinutes} minutes to execute your withdrawal of ${fromWei(
            tokensToWithdraw.toString()
          )} ${requiredCollateralSymbol}`
        );

        // Withdrawal was executed.
        return true;
      }
    }
  }

  // No transaction was sent.
  return false;
};

module.exports = withdraw;
