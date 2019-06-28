const EncryptedSender = artifacts.require("EncryptedSender");
const { getKeysForNetwork, deploy, addToTdr } = require("../../common/MigrationUtils.js");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  // Deploy EncryptedSender.
  await deploy(deployer, network, EncryptedSender, { from: keys.deployer });
};
