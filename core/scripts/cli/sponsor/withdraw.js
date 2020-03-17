const inquirer = require("inquirer");
const getDefaultAccount = require("../wallet/getDefaultAccount");

const withdraw = async (web3, artifacts, emp) => {
  const { fromWei, toWei, toBN } = web3.utils;
  const SyntheticToken = artifacts.require("SyntheticToken");
  const sponsorAddress = await getDefaultAccount(web3);
  const collateral = (await emp.getCollateral(sponsorAddress)).toString();
  const position = await emp.positions(sponsorAddress);
  const tokenAddress = await emp.tokenCurrency();
  const token = await SyntheticToken.at(tokenAddress);

  const scalingFactor = toBN(toWei("1"));

  // First check if user has a withdrawal request pending.
  const withdrawalRequestPassedTimestamp = position.requestPassTimestamp;
  if (withdrawalRequestPassedTimestamp.toString() !== "0") {
      const withdrawRequestAmount = position.withdrawalRequestAmount.toString()
      const currentTime = await emp.getCurrentTime()

      // Calculate future collateralization ratio if withdrawal request were to go through.
      const collateralPerToken = toBN(collateral)
        .sub(toBN(withdrawRequestAmount))
        .mul(scalingFactor)
        .div(toBN(position.tokensOutstanding.toString()));

      // Withdraw request is still pending. User can cancel withdraw.
      const currentTimeReadable = new Date(Number(currentTime.toString())*1000)
      const expirationTimeReadable = new Date(Number(withdrawalRequestPassedTimestamp.toString())*1000)
      if (toBN(withdrawalRequestPassedTimestamp.toString()).gt(toBN(currentTime.toString()))) {
        console.log(`You have a withdrawal request for ${fromWei(withdrawRequestAmount)} ETH that is pending until ${expirationTimeReadable}.`)
        console.log(`The current contract time is ${currentTimeReadable}.`)
        console.log("Hypothetical collateralization ratio if the withdrawal request were to go through: " + fromWei(collateralPerToken))
        const confirmation = await inquirer.prompt({
            type: "confirm",
            message: "Would you like to cancel this withdrawal?",
            default: false,
            name: "confirm"
        });
        if (confirmation["confirm"]) {
            await emp.cancelWithdrawal();
        }
      }
      // Withdraw request has passed, user can withdraw.
      else {
        console.log(`Your withdrawal request for ${fromWei(withdrawRequestAmount)} ETH has been ready since ${expirationTimeReadable}.`)
        console.log(`The current contract time is ${currentTimeReadable}.`)
        console.log("Hypothetical collateralization ratio once the withdrawal request executes: " + fromWei(collateralPerToken))
        const confirmation = await inquirer.prompt({
            type: "confirm",
            message: "Would you like to excecute this withdrawal?",
            name: "confirm"
        });
        if (confirmation["confirm"]) {
            await emp.withdrawPassedRequest();
        }
      }
  } 
  else {
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
    console.log("Current collateralization ratio: " + fromWei(collateralPerToken))

    // Calculate GCR.
    const totalPositionCollateral = toBN((await emp.totalPositionCollateral()).rawValue.toString());
    const totalTokensOutstanding = toBN((await emp.totalTokensOutstanding()).toString());  
    const gcr = totalPositionCollateral.mul(scalingFactor).divRound(totalTokensOutstanding);

    // Given current collateralization ratio and GCR, calculate maximum amount of tokens
    // user can withdraw instantly.
    const minCollateralAboveGcr = toBN(position.tokensOutstanding.toString())
        .mul(gcr)
        .divRound(scalingFactor);
    const excessCollateral = toBN(collateral).sub(minCollateralAboveGcr)
    const maxInstantWithdrawal = (excessCollateral.gt(toBN(0)) ? excessCollateral : toBN(0))
    console.log("Maximum amount you can withdraw instantly: ", fromWei(maxInstantWithdrawal))

    // Prompt user to enter withdrawal amount
    const input = await inquirer.prompt({
        name: "numCollateral",
        message: "How much ETH to withdraw?",
        validate: value =>
        (value > 0 && toBN(toWei(value)).lte(toBN(collateral))) || "Number of ETH must be positive and up to your current locked collateral"
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
            await emp.withdraw({ rawValue: tokensToWithdraw.toString() });
        }
    } 
    // Requested withdrawal amount cannot be processed instantly, call `requestWithdrawal()` 
    else {
        const withdrawalLiveness = await emp.withdrawalLiveness()
        const withdrawalLivenessInMinutes = toBN(withdrawalLiveness.toString()).div(toBN(60)).toString()
        console.log("Your requested withdrawal of ", fromWei(tokensToWithdraw), "ETH will process after ", withdrawalLivenessInMinutes, " minutes");
        const confirmation = await inquirer.prompt({
            type: "confirm",
            message: "Continue?",
            name: "confirm"
        });
        if (confirmation["confirm"]) {
            await emp.requestWithdrawal({ rawValue: tokensToWithdraw.toString() });
        }
    }
  }

};

module.exports = withdraw;
