const TokenizedDerivativeUtils = artifacts.require("TokenizedDerivativeUtils");
const { getKeysForNetwork, deployAndGet, addToTdr } = require("../../common/MigrationUtils.js");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  const tokenizedDerivativeUtils = await deployAndGet(deployer, TokenizedDerivativeUtils, { from: keys.deployer });
  await addToTdr(tokenizedDerivativeUtils, network);
};
