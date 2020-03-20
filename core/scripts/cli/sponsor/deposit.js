const inquirer = require("inquirer");
const getDefaultAccount = require("../wallet/getDefaultAccount");
const { wrapToWeth } = require("./currencyUtils.js");
const { submitTransaction } = require("./transactionUtils");

const deposit = async (web3, artifacts, emp) => {
  const ExpandedERC20 = artifacts.require("ExpandedERC20");
  const { toWei } = web3.utils;

  const input = await inquirer.prompt({
    name: "depositCollateral",
    message: "How much ETH would you like to deposit as collateral?",
    validate: value => value > 0 || "Amount of ETH must be positive"
  });
  const confirmation = await inquirer.prompt({
    type: "confirm",
    message: "Depositing " + input["depositCollateral"] + " ETH. Continue?",
    name: "confirm"
  });
  if (confirmation["confirm"]) {
    const collateral = toWei(input["depositCollateral"]);

    await wrapToWeth(web3, artifacts, emp, collateral);

    const collateralCurrency = await ExpandedERC20.at(await emp.collateralCurrency());
    await submitTransaction(
      web3,
      async () => await collateralCurrency.approve(emp.address, collateral),
      "Approving WETH transfer"
    );
    await submitTransaction(
      web3,
      async () => await emp.deposit({ rawValue: collateral.toString() }),
      "Depositing collateral"
    );
  }
};

module.exports = deposit;
