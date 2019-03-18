const TokenizedDerivativeUtils = artifacts.require("TokenizedDerivativeUtils");
const { getKeysForNetwork } = require("./MigrationUtils.js");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  await deployer.deploy(TokenizedDerivativeUtils, { from: keys.deployer });
};
