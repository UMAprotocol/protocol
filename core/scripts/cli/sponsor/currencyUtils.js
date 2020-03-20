const { submitTransaction } = require("./transactionUtils");

const wrapToWeth = async (web3, artifacts, emp, amount) => {
  const WETH9 = artifacts.require("WETH9");
  const weth = await WETH9.deployed();

  await submitTransaction(web3, async () => await weth.deposit({ value: amount.toString() }), "Wrapping ETH to WETH");
};

const unwrapToEth = async (web3, artifacts, emp, amount) => {
  const WETH9 = artifacts.require("WETH9");
  const weth = await WETH9.deployed();

  await weth.withdraw(amount.toString());
};

module.exports = {
  wrapToWeth,
  unwrapToEth
};
