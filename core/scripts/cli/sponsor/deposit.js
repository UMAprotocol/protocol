const inquirer = require("inquirer");
const getDefaultAccount = require("../wallet/getDefaultAccount");

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
    // TODO: Deal with ETH/WETH conversions here. For now, assumes sponsor has ERC20 WETH in their wallet.
    const collateral = toWei(input["depositCollateral"]);
    const collateralCurrency = await ExpandedERC20.at(await emp.collateralCurrency());
    await collateralCurrency.approve(emp.address, collateral);
    await emp.deposit({ rawValue: collateral.toString() });
  }
};

module.exports = deposit;
