const inquirer = require("inquirer");
const style = require("../textStyle");

const listMarkets = async (web3, artifacts) => {
  style.spinnerReadingContracts.start();
  const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
  const Governor = artifacts.require("Governor");
  const Registry = artifacts.require("Registry");

  const governorAddress = (await Governor.deployed()).address;

  const registry = await Registry.deployed();
  const contractAddresses = await registry.getAllRegisteredContracts();
  style.spinnerReadingContracts.stop();

  const emps = [];
  for (const address of contractAddresses) {
    // The governor is always registered as a contract, but it isn't an ExpiringMultiParty.
    if (address !== governorAddress) {
      emps.push(await ExpiringMultiParty.at(address));
    }
  }
  // TODO: Show a better formatted and selectable table here.
  console.log("LIST MARKETS:\n", emps);
};

module.exports = listMarkets;
