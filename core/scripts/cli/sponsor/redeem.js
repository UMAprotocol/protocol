const inquirer = require("inquirer");
const getDefaultAccount = require("../wallet/getDefaultAccount");
const { unwrapToEth, getIsWeth, getCurrencySymbol } = require("./currencyUtils.js");
const { submitTransaction } = require("./transactionUtils");

const redeem = async (web3, artifacts, emp) => {
  const ExpandedERC20 = artifacts.require("ExpandedERC20");
  const { fromWei, toWei, toBN } = web3.utils;
  const SyntheticToken = artifacts.require("SyntheticToken");
  const sponsorAddress = await getDefaultAccount(web3);
  const collateral = (await emp.getCollateral(sponsorAddress)).toString();
  const position = await emp.positions(sponsorAddress);

  const collateralCurrency = await ExpandedERC20.at(await emp.collateralCurrency());
  const isWeth = await getIsWeth(web3, artifacts, collateralCurrency);
  const collateralSymbol = await getCurrencySymbol(web3, artifacts, collateralCurrency);
  const requiredCollateralSymbol = isWeth ? "ETH" : collateralSymbol;

  const tokenAddress = await emp.tokenCurrency();
  const token = await SyntheticToken.at(tokenAddress);
  const walletTokens = await token.balanceOf(sponsorAddress);

  console.log("Your wallet has: " + fromWei(walletTokens) + " synthetic tokens");

  const scalingFactor = toBN(toWei("1"));
  const collateralPerToken = toBN(collateral)
    .mul(scalingFactor)
    .div(toBN(position.tokensOutstanding.toString()));
  const input = await inquirer.prompt({
    name: "numTokens",
    message: "How many tokens to repay, at " + fromWei(collateralPerToken) + " " + requiredCollateralSymbol + " each?",
    validate: value =>
      (value > 0 && toBN(toWei(value)).lte(toBN(walletTokens))) ||
      "Number of tokens must be positive and up to your current balance"
  });

  const tokensToRedeem = toBN(toWei(input["numTokens"]));
  const expectedCollateral = collateralPerToken.mul(toBN(tokensToRedeem)).div(scalingFactor);
  console.log("You'll receive", fromWei(expectedCollateral), requiredCollateralSymbol);
  const confirmation = await inquirer.prompt({
    type: "confirm",
    message: "Continue?",
    name: "confirm"
  });
  if (confirmation["confirm"]) {
    const totalTransactions = isWeth ? 3 : 2;
    let transactionNum = 1;
    await submitTransaction(
      web3,
      async () => await token.approve(emp.address, tokensToRedeem),
      "Approving synthetic token transfer",
      transactionNum,
      totalTransactions
    );
    transactionNum++;
    await submitTransaction(
      web3,
      async () => await emp.redeem({ rawValue: tokensToRedeem.toString() }),
      "Repaying tokens",
      transactionNum,
      totalTransactions
    );
    transactionNum++;
    if (isWeth) {
      await unwrapToEth(web3, artifacts, emp, expectedCollateral, transactionNum, totalTransactions);
    }
  }
};

module.exports = redeem;
