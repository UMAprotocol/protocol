const TokenizedDerivativeUtils = artifacts.require("TokenizedDerivativeUtils");
const { getKeysForNetwork, deploy } = require("../../common/MigrationUtils.js");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  const tokenizedDerivativeUtils = await deploy(deployer, network, TokenizedDerivativeUtils, { from: keys.deployer });
};
