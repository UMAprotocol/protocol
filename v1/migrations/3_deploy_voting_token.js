const VotingToken = artifacts.require("VotingToken");
const Voting = artifacts.require("Voting");
const { getKeysForNetwork, deployAndGet, addToTdr } = require("../../common/MigrationUtils.js");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  const votingToken = await deployAndGet(deployer, VotingToken, { from: keys.deployer });
  await addToTdr(votingToken, network);

  // Corresponds to VotingToken.Roles.Minter;
  const minterRoleEnumValue = 1;
  // Set the minter to be Voting.sol.
  const voting = await Voting.deployed();
  await votingToken.resetMember(minterRoleEnumValue, voting.address, { from: keys.deployer });
};
