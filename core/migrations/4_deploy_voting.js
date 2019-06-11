const Finder = artifacts.require("Finder");
const Voting = artifacts.require("Voting");
const VotingToken = artifacts.require("VotingToken");
const {
  getKeysForNetwork,
  deployAndGet,
  addToTdr,
  enableControllableTiming
} = require("../../common/MigrationUtils.js");
const { interfaceName } = require("../utils/Constants.js");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);
  const controllableTiming = enableControllableTiming(network);

  // Set the GAT percentage to 5%
  const gatPercentage = { value: web3.utils.toWei("0.05", "ether") };

  // Set the inflation rate.
  const inflationRate = { value: web3.utils.toWei("0.05", "ether") };

  // Get the previously deployed VotingToken and Finder.
  const votingToken = await VotingToken.deployed();
  const finder = await Finder.deployed();

  // Set phase length to one day.
  const secondsPerDay = "86400";

  const voting = await deployAndGet(
    deployer,
    Voting,
    secondsPerDay,
    gatPercentage,
    inflationRate,
    votingToken.address,
    finder.address,
    controllableTiming,
    { from: keys.deployer }
  );
  await addToTdr(voting, network);

  await finder.changeImplementationAddress(web3.utils.utf8ToHex(interfaceName.Oracle), voting.address, {
    from: keys.deployer
  });

  // Corresponds to VotingToken.Roles.Minter.
  const minterRoleEnumValue = 1;

  // Set the minter to be the Voting contract.
  await votingToken.addMember(minterRoleEnumValue, voting.address, { from: keys.deployer });
};
