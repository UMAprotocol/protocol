const Voting = artifacts.require("Voting");
const { getKeysForNetwork, deployAndGet, addToTdr } = require("../../common/MigrationUtils.js");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  const voting = await deployAndGet(deployer, Voting, { from: keys.deployer });
  await addToTdr(voting, network);
};
