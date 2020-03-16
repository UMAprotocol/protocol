const inquirer = require("inquirer");
const style = require("../textStyle");
const showMarketDetails = require("./showMarketDetails");

const listMarkets = async (web3, artifacts) => {
  style.spinnerReadingContracts.start();
  const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
  const Registry = artifacts.require("Registry");

  const SyntheticToken = artifacts.require("SyntheticToken");
  const Governor = artifacts.require("Governor");

  const registry = await Registry.deployed();
  const contractAddresses = await registry.getAllRegisteredContracts();
  style.spinnerReadingContracts.stop();

  const emps = [];
  for (const address of contractAddresses) {
    // The governor is always registered as a contract, but it isn't an ExpiringMultiParty.
    if (address !== Governor.address) {
      emps.push(await ExpiringMultiParty.at(address));
    }
  }

  // Format a useful display message for each market.
  const backChoice = "Back";
  const choices = [];
  for (let i = 0; i < emps.length; i++) {
    const emp = emps[i];

    const tokenAddress = await emp.tokenCurrency();
    const token = await SyntheticToken.at(tokenAddress);
    const name = await token.name();

    const collateralRequirement = await emp.collateralRequirement();
    const asPercent = web3.utils.fromWei(collateralRequirement.muln(100).toString());

    const etherscanLink = "https://etherscan.io/address/" + emp.address;
    const display = name + ". " + asPercent + "% collateral required. " + etherscanLink;

    // Using the index as the value lets us easily find the right EMP.
    choices.push({ name: display, value: i });
  }
  choices.push({ name: backChoice });
  const prompt = {
    type: "list",
    name: "chosenEmpIdx",
    message: "Pick a market",
    choices: choices
  };
  const input = await inquirer.prompt(prompt);
  if (input["chosenEmpIdx"] !== backChoice) {
    await showMarketDetails(web3, artifacts, emps[input["chosenEmpIdx"]]);
  }
};

module.exports = listMarkets;
