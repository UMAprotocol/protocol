const { submitTransaction } = require("./transactionUtils");
const WETH9 = require("@umaprotocol/core/build/contracts/WETH9.json");

const wrapToWeth = async (web3, artifacts, emp, amount, transactionNum, totalTransactions) => {
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
  return collateralCurrency.address === WETH9.address;
};

const getCurrencySymbol = async (web3, artifacts, collateralCurrency) => {
  if (await getIsWeth(web3, artifacts, collateralCurrency)) {
    return "WETH";
  } else {
    try {
      return await collateralCurrency.symbol();
    } catch (err) {
      // Return this if we cannot read `symbol()`.
      return "collateral tokens";
    }
  }
};

module.exports = {
  getCurrencySymbol,
  getIsWeth,
  wrapToWeth,
  unwrapToEth
};
