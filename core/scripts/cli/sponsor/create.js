const BigNumber = require("bignumber.js");
const inquirer = require("inquirer");
const { wrapToWeth, getCurrencySymbol, getIsWeth } = require("./currencyUtils");
const { submitTransaction } = require("./transactionUtils");
const getDefaultAccount = require("../wallet/getDefaultAccount");

// Apply settings to BigNumber.js library.
// Note: ROUNDING_MODE is set to round ceiling so we send at least enough collateral to create the requested tokens.
// Note: RANGE is set to 500 so values don't overflow to infinity until they hit +-1e500.
// Note: EXPONENTIAL_AT is set to 500 to keep BigNumber from using exponential notation until the numbers hit
// +-1e500.
BigNumber.set({ ROUNDING_MODE: 2, RANGE: 500, EXPONENTIAL_AT: 500 });

const create = async (web3, artifacts, emp, hasExistingPosition) => {
  const ExpandedERC20 = artifacts.require("ExpandedERC20");
  const { toWei, fromWei } = web3.utils;
  const account = await getDefaultAccount(web3);

  // TODO: Understand why we need a .rawValue in one case but not the other.
  const totalPositionCollateral = BigNumber((await emp.totalPositionCollateral()).rawValue.toString());
  const totalTokensOutstanding = BigNumber((await emp.totalTokensOutstanding()).toString());
  const minPositionSize = BigNumber((await emp.minSponsorTokens()).toString());
  if (totalTokensOutstanding.isZero()) {
    // When creating the globally first position, we wouldn't have a GCR. Therefore, creating that position is a
    // different flow that isn't currently part of this tool.
    console.log("Error: This tool does not currently support creating the chosen market's first position");

    // No creation occurred.
    return false;
  }

  const input = await inquirer.prompt({
    message: hasExistingPosition
      ? "How many tokens to create?"
      : `How many tokens to create (must be > ${fromWei(minPositionSize.toString())})?`,
    name: "tokensCreated",
    validate: value => {
      if (hasExistingPosition) {
        return value > 0 || "Number of tokens must be positive";
      } else {
        return (
          BigNumber(toWei(value)).gte(minPositionSize) ||
          `Position cannot be smaller than ${fromWei(minPositionSize.toString())} tokens`
        );
      }
    }
  });

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

  // Check if user has enough balance to continue.
  const userCollateralBalance = await collateralCurrency.balanceOf(account);
  if (BigNumber(userCollateralBalance).lt(collateralNeeded)) {
    console.log(
      `You do not have enough collateral to create this position. Your current collateral balance is: ${fromWei(
        userCollateralBalance
      )} ${requiredCollateralSymbol}`
    );

    // No creation occurred.
    return false;
  }

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
      "Minting synthetic tokens",
      transactionNum,
      totalTransactions
    );
    // TODO: Add link to uniswap and bolded messaging.

    // Indicates that the user successfully created tokens.
    return true;
  }

  // No creation occurred.
  return false;
};

module.exports = create;
