const inquirer = require("inquirer");
const getDefaultAccount = require("../wallet/getDefaultAccount");
const { PositionStatesEnum } = require("../../../../common/Enums");

const showExpiredMarketDetails = async (web3, artifacts, emp) => {
  const SyntheticToken = artifacts.require("SyntheticToken");

  const { fromWei } = web3.utils;

  const contractState = (await emp.contractState()).toString();
  if (contractState === PositionStatesEnum.EXPIRED_PRICE_REQUESTED) {
    console.log("This contract is waiting for a price from the Oracle. Please check back later.");
  } else {
    const expiryPrice = (await emp.expiryPrice()).toString();
    console.log(`This market settled to ${fromWei(expiryPrice)}`);

    const sponsorAddress = await getDefaultAccount(web3);
    const collateral = (await emp.getCollateral(sponsorAddress)).toString();

    const tokenAddress = await emp.tokenCurrency();
    const token = await SyntheticToken.at(tokenAddress);
    const walletTokens = (await token.balanceOf(sponsorAddress)).toString();

    console.log(`You have ${fromWei(walletTokens)} tokens and ${fromWei(collateral)} collateral`);
  }
};

module.exports = showExpiredMarketDetails;
