const EncryptedSender = artifacts.require("EncryptedSender");
const { getKeysForNetwork, deployAndGet, addToTdr } = require("../../common/MigrationUtils.js");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  // Deploy EncryptedSender.
  const encryptedSender = await deployAndGet(deployer, EncryptedSender, { from: keys.deployer });
  await addToTdr(encryptedSender, network);
};
