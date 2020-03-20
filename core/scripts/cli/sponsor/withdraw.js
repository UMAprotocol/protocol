const inquirer = require("inquirer");
const getDefaultAccount = require("../wallet/getDefaultAccount");
const { unwrapToEth } = require("./currencyUtils.js");
const { submitTransaction } = require("./transactionUtils");

const withdraw = async (web3, artifacts, emp) => {
  const { fromWei, toWei, toBN } = web3.utils;
  const sponsorAddress = await getDefaultAccount(web3);
  const collateral = (await emp.getCollateral(sponsorAddress)).toString();
  const position = await emp.positions(sponsorAddress);

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
    }
  };

  // Execute pending withdrawal.
  const executeWithdrawal = async withdrawRequestAmount => {
    const confirmation = await inquirer.prompt({
      type: "confirm",
      message: "Would you like to excecute this withdrawal?",
      name: "confirm"
    });
    if (confirmation["confirm"]) {
      await submitTransaction(web3, async () => await emp.withdrawPassedRequest(), "Withdrawing WETH");
      await unwrapToEth(web3, artifacts, emp, withdrawRequestAmount);
    }
  };

  // First check if user has a withdrawal request pending.
  const withdrawalRequestPassedTimestamp = position.requestPassTimestamp;
  if (withdrawalRequestPassedTimestamp.toString() !== "0") {
    const withdrawRequestAmount = position.withdrawalRequestAmount.toString();
    const currentTime = await emp.getCurrentTime();

    // Calculate future collateralization ratio if withdrawal request were to go through.
    const collateralPerToken = toBN(collateral)
      .sub(toBN(withdrawRequestAmount))
      .mul(scalingFactor)
      .div(toBN(position.tokensOutstanding.toString()));

    // Get current contract time and withdrawal request expiration time.
    const currentTimeReadable = new Date(Number(currentTime.toString()) * 1000);
    // Withdrawal request expires AFTER the withdraw request time, so add one second to the expiration time displayed.
    const expirationTimeReadable = new Date(Number(withdrawalRequestPassedTimestamp.toString()) * 1000 + 1);

    // Withdraw request is still pending. User can cancel withdraw.
    if (toBN(withdrawalRequestPassedTimestamp.toString()).gte(toBN(currentTime.toString()))) {
      console.log(
        `You have a withdrawal request for ${fromWei(
          withdrawRequestAmount
        )} ETH that is pending until ${expirationTimeReadable}.`
      );
      console.log(`The current contract time is ${currentTimeReadable}.`);
      console.log(
        "Hypothetical collateralization ratio if the withdrawal request were to go through: " +
          fromWei(collateralPerToken)
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
          await cancelWithdrawal();
          break;
        case "Back":
          return;
        default:
          console.log("unimplemented state");
      }
    }
    // Withdraw request has passed, user can withdraw or cancel.
    else {
      console.log(
        `Your withdrawal request for ${fromWei(
          withdrawRequestAmount
        )} ETH has been ready since ${expirationTimeReadable}.`
      );
      console.log(`The current contract time is ${currentTimeReadable}.`);
      console.log(
        "Hypothetical collateralization ratio once the withdrawal request executes: " + fromWei(collateralPerToken)
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
          await executeWithdrawal(withdrawRequestAmount);
          break;
        case "Cancel Pending Withdrawal":
          await cancelWithdrawal();
          break;
        case "Back":
          return;
        default:
          console.log("unimplemented state");
      }
    }
  } else {
    console.log("You have:");
    console.log(
      "Position: " +
        fromWei(collateral) +
        " WETH backing " +
        fromWei(position.tokensOutstanding.toString()) +
        " synthetic tokens"
    );

    // Calculate current collateralization ratio.
    const collateralPerToken = toBN(collateral)
      .mul(scalingFactor)
      .div(toBN(position.tokensOutstanding.toString()));
    console.log("Current collateralization ratio: " + fromWei(collateralPerToken));

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
    console.log("Maximum amount you can withdraw instantly: ", fromWei(maxInstantWithdrawal));

    // Prompt user to enter withdrawal amount
    const input = await inquirer.prompt({
      name: "numCollateral",
      message: "How much ETH to withdraw?",
      validate: value =>
        (value > 0 && toBN(toWei(value)).lte(toBN(collateral))) ||
        "Number of ETH must be positive and up to your current locked collateral"
    });
    const tokensToWithdraw = toBN(toWei(input["numCollateral"]));

    // Requested withdrawal amount can be processed instantly, call `withdraw()`
    if (tokensToWithdraw.lte(maxInstantWithdrawal)) {
      console.log("Your withdrawal of ", fromWei(tokensToWithdraw), "ETH will process instantly");
      const confirmation = await inquirer.prompt({
        type: "confirm",
        message: "Continue?",
        name: "confirm"
      });
      if (confirmation["confirm"]) {
        await submitTransaction(
          web3,
          async () => await emp.withdraw({ rawValue: tokensToWithdraw.toString() }),
          "Withdrawing WETH"
        );
        await unwrapToEth(web3, artifacts, emp, tokensToWithdraw.toString());
      }
    }
    // Requested withdrawal amount cannot be processed instantly, call `requestWithdrawal()`
    else {
      const withdrawalLiveness = await emp.withdrawalLiveness();
      const withdrawalLivenessInMinutes = toBN(withdrawalLiveness.toString())
        .div(toBN(60))
        .toString();
      console.log(
        "Your requested withdrawal of ",
        fromWei(tokensToWithdraw),
        "ETH will process after ",
        withdrawalLivenessInMinutes,
        " minutes"
      );
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
      }
    }
  }
};

module.exports = withdraw;
