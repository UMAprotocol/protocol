const BigNumber = require("bignumber.js");
const inquirer = require("inquirer");
const { wrapToWeth, getCurrencySymbol, getIsWeth } = require("./currencyUtils");
const { submitTransaction } = require("./transactionUtils");

const create = async (web3, artifacts, emp) => {
  const ExpandedERC20 = artifacts.require("ExpandedERC20");
  const { toWei, fromWei } = web3.utils;

  // TODO: Understand why we need a .rawValue in one case but not the other.
  const totalPositionCollateral = BigNumber((await emp.totalPositionCollateral()).rawValue.toString());
  const totalTokensOutstanding = BigNumber((await emp.totalTokensOutstanding()).toString());
  if (totalTokensOutstanding.isZero()) {
    // When creating the globally first position, we wouldn't have a GCR. Therefore, creating that position is a
    // different flow that isn't currently part of this tool.
    console.log("Error: This tool does not currently support creating the chosen market's first position");
    return;
  }

  const input = await inquirer.prompt({
    message: "How many tokens to create?",
    name: "tokensCreated",
    validate: value => value > 0 || "Number of tokens must be positive"
  });
  // Use BigNumber.js to so that we can set ROUNDING_MODE to round ceiling. We need to do this to make sure we send
  // enough collateral to create the requested tokens.
  BigNumber.set({ ROUNDING_MODE: 2 });
  const scalingFactor = BigNumber(toWei("1"));
  const tokens = BigNumber(toWei(input["tokensCreated"]));
  const gcr = totalPositionCollateral.times(scalingFactor).div(totalTokensOutstanding);
  const collateralNeeded = tokens
    .times(gcr)
    .div(scalingFactor)
    .integerValue()
    .toString();
  const collateralCurrency = await ExpandedERC20.at(await emp.collateralCurrency());
  const isWeth = await getIsWeth(web3, artifacts, collateralCurrency);
  const collateralSymbol = await getCurrencySymbol(web3, artifacts, collateralCurrency);
  const requiredCollateralSymbol = isWeth ? "ETH" : collateralSymbol;
  console.log(`You'll need ${fromWei(collateralNeeded)} ${requiredCollateralSymbol} to mint tokens`);
  const confirmation = await inquirer.prompt({
    type: "confirm",
    message: "Continue?",
    name: "confirm"
  });

  if (confirmation["confirm"]) {
    let totalTransactions = 2;
    let transactionNum = 1;
    if (isWeth) {
      totalTransactions = 3;
      await wrapToWeth(web3, artifacts, emp, collateralNeeded, transactionNum, totalTransactions);
      transactionNum++;
    }
    await submitTransaction(
      web3,
      async () => await collateralCurrency.approve(emp.address, collateralNeeded),
      `Approving ${collateralSymbol} transfer`,
      transactionNum,
      totalTransactions
    );
    transactionNum++;
    await submitTransaction(
      web3,
      async () => await emp.create({ rawValue: collateralNeeded }, { rawValue: tokens.toString() }),
      "Minting more tokens",
      transactionNum,
      totalTransactions
    );
    // TODO: Add link to uniswap and bolded messaging.
  }
};

module.exports = create;
