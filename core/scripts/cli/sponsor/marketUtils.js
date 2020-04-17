const style = require("../textStyle");
const PublicNetworks = require("../../../../common/PublicNetworks");
const { getCurrencySymbol } = require("./currencyUtils.js");

const getMarketSummary = async (web3, artifacts) => {
  style.spinnerReadingContracts.start();
  const ExpandedERC20 = artifacts.require("ExpandedERC20");
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
      // Additional check that the address is a contract.
      try {
        emps.push(await ExpiringMultiParty.at(address));
      } catch (err) {
        continue;
      }
    }
  }

  const markets = [];
  const etherscanBaseUrl = PublicNetworks[web3.networkId]
    ? PublicNetworks[web3.networkId].etherscan
    : "https://fake-etherscan.com";
  for (let i = 0; i < emps.length; i++) {
    const emp = emps[i];
    const contractState = (await emp.contractState()).toString();

    const tokenAddress = await emp.tokenCurrency();
    const token = await SyntheticToken.at(tokenAddress);
    const name = await token.name();
    const symbol = await token.symbol();

    const collateralRequirement = await emp.collateralRequirement();

    const collateralCurrency = await ExpandedERC20.at(await emp.collateralCurrency());
    const collateralSymbol = await getCurrencySymbol(web3, artifacts, collateralCurrency);

    const expirationTimestamp = (await emp.expirationTimestamp()).toString();

    const etherscanLink = `${etherscanBaseUrl}/contracts/${emp.address}`;

    markets.push({
      emp,
      contractState,
      name,
      symbol,
      collateralRequirement,
      collateralSymbol,
      expirationTimestamp,
      etherscanLink
    });
  }
  return markets;
};

module.exports = {
  getMarketSummary
};
