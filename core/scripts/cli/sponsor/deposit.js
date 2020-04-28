const inquirer = require("inquirer");
const getDefaultAccount = require("../wallet/getDefaultAccount");
const { wrapToWeth, getIsWeth, getCurrencySymbol } = require("./currencyUtils.js");
const { submitTransaction } = require("./transactionUtils");

const deposit = async (web3, artifacts, emp) => {
  const ExpandedERC20 = artifacts.require("ExpandedERC20");
  const { toWei } = web3.utils;
  const collateralCurrency = await ExpandedERC20.at(await emp.collateralCurrency());
  const isWeth = await getIsWeth(web3, artifacts, collateralCurrency);
  const collateralSymbol = await getCurrencySymbol(web3, artifacts, collateralCurrency);
  const requiredCollateralSymbol = isWeth ? "ETH" : collateralSymbol;

  const input = await inquirer.prompt({
    name: "depositCollateral",
    message: `How much ${requiredCollateralSymbol} would you like to deposit as collateral?`,
    validate: value => value > 0 || `Amount of ${requiredCollateralSymbol} must be positive`
  });
  const confirmation = await inquirer.prompt({
    type: "confirm",
    message: `Depositing ${input["depositCollateral"]} ${requiredCollateralSymbol}. Continue?`,
    name: "confirm"
  });
  if (confirmation["confirm"]) {
    const collateral = toWei(input["depositCollateral"]);

    let totalTransactions = 2;
    let transactionNum = 1;
    if (isWeth) {
      totalTransactions = 3;
      await wrapToWeth(web3, artifacts, emp, collateral, transactionNum, totalTransactions);
      transactionNum++;
    }

    await submitTransaction(
      web3,
      async () => await collateralCurrency.approve(emp.address, collateral),
      `Approving ${collateralSymbol} transfer`,
      transactionNum,
      totalTransactions
    );
    transactionNum++;
    await submitTransaction(
      web3,
      async () => await emp.deposit({ rawValue: collateral.toString() }),
      "Depositing collateral",
      transactionNum,
      totalTransactions
    );
  }
};

module.exports = deposit;
