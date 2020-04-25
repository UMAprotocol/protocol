const { submitTransaction } = require("./transactionUtils");

const wrapToWeth = async (web3, artifacts, emp, amount, transactionNum, totalTransactions) => {
  const WETH9 = artifacts.require("WETH9");
  const weth = await WETH9.deployed();

  await submitTransaction(
    web3,
    async () => await weth.deposit({ value: amount.toString() }),
    "Wrapping ETH to WETH",
    transactionNum,
    totalTransactions
  );
};

const unwrapToEth = async (web3, artifacts, emp, amount, transactionNum, totalTransactions) => {
  const WETH9 = artifacts.require("WETH9");
  const weth = await WETH9.deployed();

  await submitTransaction(
    web3,
    async () => await weth.withdraw(amount.toString()),
    "Unwrapping WETH to ETH",
    transactionNum,
    totalTransactions
  );
};

const getIsWeth = async (web3, artifacts, collateralCurrency) => {
  const WETH9 = artifacts.require("WETH9");
  return collateralCurrency.address === WETH9.address;
};

const getCurrencySymbol = async (web3, artifacts, collateralCurrency) => {
  if (await getIsWeth(web3, artifacts, collateralCurrency)) {
    return "WETH";
  } else {
    // TODO: Do all collateral currencies we care about support `symbol()`?
    return "collateral tokens";
  }
};

module.exports = {
  getCurrencySymbol,
  getIsWeth,
  wrapToWeth,
  unwrapToEth
};
