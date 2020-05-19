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

  const emps = await Promise.all(
    contractAddresses.map(async address => {
      // The governor is always registered as a contract, but it isn't an ExpiringMultiParty.
      if (address !== Governor.address) {
        // Additional check that the address is a contract.
        try {
          return await ExpiringMultiParty.at(address);
        } catch (err) {
          return null;
        }
      }
    })
  );

  const etherscanBaseUrl = PublicNetworks[web3.networkId]
    ? PublicNetworks[web3.networkId].etherscan
    : "https://fake-etherscan.com";

  const markets = await Promise.all(
    emps.map(async emp => {
      if (!emp) {
        return null;
      }

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

      return {
        emp,
        contractState,
        name,
        symbol,
        collateralRequirement,
        collateralSymbol,
        expirationTimestamp,
        etherscanLink
      };
    })
  );

  style.spinnerReadingContracts.stop();

  return markets;
};

module.exports = {
  getMarketSummary
};
