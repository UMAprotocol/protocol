const CentralizedStore = artifacts.require("CentralizedStore");
const { getKeysForNetwork, deployAndGet, addToTdr } = require("../../common/MigrationUtils.js");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  const centralizedStore = await deployAndGet(deployer, CentralizedStore, { from: keys.store });
  await addToTdr(centralizedStore, network);

  // Set oracle fees to 0.5% per year.
  const annualFee = web3.utils.toWei("0.005");
  const secondsPerYear = 31536000;
  const feePerSecond = web3.utils.toBN(annualFee).divn(secondsPerYear);
  await centralizedStore.setFixedOracleFeePerSecond(feePerSecond.toString(), { from: keys.store });
};
