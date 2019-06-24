const VotingToken = artifacts.require("VotingToken");
const Voting = artifacts.require("Voting");
const { getKeysForNetwork, deploy, addToTdr } = require("../../common/MigrationUtils.js");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  await deploy(deployer, network, VotingToken, { from: keys.deployer });
};
