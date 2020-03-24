const inquirer = require("inquirer");
const getDefaultAccount = require("../wallet/getDefaultAccount");

const transfer = async (web3, artifacts, emp) => {
  const { fromWei, isAddress } = web3.utils;
  const input = await inquirer.prompt({
    name: "address",
    message: "Which address would you like to transfer to?",
    validate: value => isAddress(value) || "Invalid address"
  });

  const targetCollateral = (await emp.getCollateral(input["address"])).toString();
  if (targetCollateral !== "0") {
    console.log(
      "Target address already has",
      fromWei(targetCollateral),
      "WETH. Can only transfer to an owner without a position"
    );
    return;
  }

  const confirmation = await inquirer.prompt({
    type: "confirm",
    message: "Transferring to " + input["address"] + ". This cannot be reversed!",
    name: "confirm"
  });
  if (confirmation["confirm"]) {
    await emp.transfer(input["address"]);
  }
};

module.exports = transfer;
