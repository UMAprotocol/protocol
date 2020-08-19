const style = require("../textStyle");
const winston = require("winston");
const { getCurrencySymbol } = require("./currencyUtils.js");
const { createReferencePriceFeedForEmp, Networker } = require("@uma/financial-templates-lib");
const { computeCollateralizationRatio, createFormatFunction, PublicNetworks } = require("@uma/common");

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

  const networkId = await web3.eth.net.getId();

  const etherscanBaseUrl = PublicNetworks[networkId]
    ? PublicNetworks[networkId].etherscan
    : "https://fake-etherscan.com/";

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

      const etherscanLink = `${etherscanBaseUrl}address/${emp.address}`;

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

async function getCollateralizationRatio(web3, empAddress, collateral, tokens) {
  const { toBN, toWei } = web3.utils;
  let priceFeed;
  try {
    // TODO: change createReferencePriceFeedForEmp to allow a null or undefined logger instead of forcing the caller
    // to provide a silent logger.
    priceFeed = await createReferencePriceFeedForEmp(
      winston.createLogger({ silent: true }),
      web3,
      new Networker(),
      () => Math.floor(Date.now() / 1000),
      empAddress
    );
  } catch (error) {
    console.log(error);
    // Ignore error
  }

  if (!priceFeed) {
    return "Unknown";
  }

  await priceFeed.update();
  const currentPrice = priceFeed.getCurrentPrice();

  if (!currentPrice) {
    return "Unknown";
  }

  const collateralizationRatio = await computeCollateralizationRatio(
    web3,
    currentPrice,
    toBN(collateral.toString()),
    toBN(tokens.toString())
  );
  const format = createFormatFunction(web3, 2, 4);
  return format(collateralizationRatio.muln(100)) + "%";
}

module.exports = {
  getMarketSummary,
  getCollateralizationRatio
};
