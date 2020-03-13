const inquirer = require("inquirer");
const getDefaultAccount = require("../wallet/getDefaultAccount");
const create = require("./create");

const showMarketDetails = async (web3, artifacts, emp) => {
  console.log("show market details on ", emp.address);
  const sponsorAddress = await getDefaultAccount(web3);
  const collateral = await emp.getCollateral(sponsorAddress);

  const backAction = "Back";
  if (collateral.toString() === "0") {
    // Sponsor doesn't have a position.
    const prompt = {
      type: "list",
      name: "choice",
      message: "You are not currently a sponsor",
      choices: [{ name: "Sponsor new position" }, { name: backAction }]
    };
    const input = await inquirer.prompt(prompt);
    if (input["choice"] !== backAction) {
      await create(web3, artifacts, emp);
    }
  } else {
    console.log("TODO: Existing position");
  }
};

module.exports = showMarketDetails;
