const inquirer = require("inquirer");
const getDefaultAccount = require("../wallet/getDefaultAccount");
const { unwrapToEth, getIsWeth, getCurrencySymbol } = require("./currencyUtils.js");
const { submitTransaction } = require("./transactionUtils");

const redeem = async (web3, artifacts, emp) => {
  const ExpandedERC20 = artifacts.require("ExpandedERC20");
  const { BN, fromWei, toWei, toBN } = web3.utils;
  const SyntheticToken = artifacts.require("SyntheticToken");
  const sponsorAddress = await getDefaultAccount(web3);
  const collateral = (await emp.getCollateral(sponsorAddress)).toString();
  const position = await emp.positions(sponsorAddress);
  const minSponsorTokens = toBN((await emp.minSponsorTokens()).toString());

  const collateralCurrency = await ExpandedERC20.at(await emp.collateralCurrency());
  const isWeth = await getIsWeth(web3, artifacts, collateralCurrency);
  const collateralSymbol = await getCurrencySymbol(web3, artifacts, collateralCurrency);
  const requiredCollateralSymbol = isWeth ? "ETH" : collateralSymbol;

  const tokenAddress = await emp.tokenCurrency();
  const token = await SyntheticToken.at(tokenAddress);
  const walletTokens = toBN((await token.balanceOf(sponsorAddress)).toString());
  const positionTokens = toBN(position.tokensOutstanding.toString());

  const scalingFactor = toBN(toWei("1"));
  const collateralPerToken = toBN(collateral)
    .mul(scalingFactor)
    .div(positionTokens);
  // A partial redemption must leave minSponsorTokens still in the Position. A full redemption of the position is also
  // allowed.
  const maxTokens = BN.min(walletTokens, positionTokens.sub(minSponsorTokens));
  const input = await inquirer.prompt({
    name: "numTokens",
    message: `Your wallet has ${fromWei(walletTokens)} synthetic tokens. How many tokens to repay, at ${fromWei(
      collateralPerToken
    )} ${requiredCollateralSymbol} each?`,
    validate: value =>
      (value > 0 && (toBN(toWei(value)).lte(maxTokens) || toBN(toWei(value)).eq(positionTokens))) ||
      `Number of tokens must be between 0 and ${fromWei(maxTokens)}, or exactly ${fromWei(positionTokens)}`
  });

  const tokensToRedeem = toBN(toWei(input["numTokens"]));
  const expectedCollateral = collateralPerToken.mul(toBN(tokensToRedeem)).div(scalingFactor);
  console.log(`You'll receive approximately ${fromWei(expectedCollateral)} ${requiredCollateralSymbol}`);
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

    // Simulate redemption to confirm exactly how much collateral you will receive back.
    const exactCollateral = await emp.redeem.call({ rawValue: tokensToRedeem.toString() });
    await submitTransaction(
      web3,
      async () => await emp.redeem({ rawValue: tokensToRedeem.toString() }),
      "Repaying tokens",
      transactionNum,
      totalTransactions
    );
    transactionNum++;
    if (isWeth) {
      await unwrapToEth(web3, artifacts, emp, exactCollateral, transactionNum, totalTransactions);
    }
  }
};

module.exports = redeem;
