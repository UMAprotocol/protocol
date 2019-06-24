const Finder = artifacts.require("Finder");
const Store = artifacts.require("Store");

const { getKeysForNetwork, deploy, addToTdr } = require("../../common/MigrationUtils.js");
const { interfaceName } = require("../utils/Constants.js");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  const { contract: store, didDeploy } = await deploy(deployer, network, Store, { from: keys.store });

  const finder = await Finder.deployed();
  await finder.changeImplementationAddress(web3.utils.utf8ToHex(interfaceName.Store), store.address, {
    from: keys.deployer
  });

  // Only update the fees if this contract was newly deployed during this migration.
  if (didDeploy) {
    // Set oracle fees to 0.5% per year.
    const annualFee = web3.utils.toWei("0.005");
    const secondsPerYear = 31536000;
    const feePerSecond = web3.utils.toBN(annualFee).divn(secondsPerYear);
    await store.setFixedOracleFeePerSecond({ value: feePerSecond.toString() }, { from: keys.store });
  }
};
