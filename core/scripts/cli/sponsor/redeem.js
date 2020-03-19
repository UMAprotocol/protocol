const inquirer = require("inquirer");
const getDefaultAccount = require("../wallet/getDefaultAccount");
const { unwrapToEth } = require("./currencyUtils.js");

const redeem = async (web3, artifacts, emp) => {
  const { fromWei, toWei, toBN } = web3.utils;
  const SyntheticToken = artifacts.require("SyntheticToken");
  const sponsorAddress = await getDefaultAccount(web3);
  const collateral = (await emp.getCollateral(sponsorAddress)).toString();
  const position = await emp.positions(sponsorAddress);

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
    message: "How many tokens to repay, at " + fromWei(collateralPerToken) + " ETH each?",
    validate: value =>
      (value > 0 && toBN(toWei(value)).lte(toBN(walletTokens))) ||
      "Number of tokens must be positive and up to your current balance"
  });

  const tokensToRedeem = toBN(toWei(input["numTokens"]));
  const expectedCollateral = collateralPerToken.mul(toBN(tokensToRedeem)).div(scalingFactor);
  console.log("You'll receive", fromWei(expectedCollateral), "ETH");
  const confirmation = await inquirer.prompt({
    type: "confirm",
    message: "Continue?",
    name: "confirm"
  });
  if (confirmation["confirm"]) {
    await token.approve(emp.address, tokensToRedeem);
    await emp.redeem({ rawValue: tokensToRedeem.toString() });
    await unwrapToEth(web3, artifacts, emp, expectedCollateral);
  }
};

module.exports = redeem;
