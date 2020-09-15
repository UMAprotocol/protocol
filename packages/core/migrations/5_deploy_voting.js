const Finder = artifacts.require("Finder");
const Voting = artifacts.require("Voting");
const VotingToken = artifacts.require("VotingToken");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const Timer = artifacts.require("Timer");
const { getKeysForNetwork, deploy, enableControllableTiming, interfaceName } = require("@uma/common");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);
  const controllableTiming = enableControllableTiming(network);

  // .deployed() will fail if called on a network where the is no Timer (!controllableTiming).
  const timerAddress = controllableTiming
    ? (await Timer.deployed()).address
    : "0x0000000000000000000000000000000000000000";

  // Deploy whitelist of identifiers
  const { contract: identifierWhitelist } = await deploy(deployer, network, IdentifierWhitelist, {
    from: keys.deployer
  });

  // Set the GAT percentage to 5%
  const gatPercentage = { rawValue: web3.utils.toWei("0.05", "ether") };

  // Set the inflation rate.
  const inflationRate = { rawValue: web3.utils.toWei("0.0005", "ether") };

  // Set the rewards expiration timeout.
  const rewardsExpirationTimeout = 60 * 60 * 24 * 14; // Two weeks.

  // Get the previously deployed VotingToken and Finder.
  const votingToken = await VotingToken.deployed();
  const finder = await Finder.deployed();

  // Set phase length to one day.
  const secondsPerDay = "86400";

  const { contract: voting } = await deploy(
    deployer,
    network,
    Voting,
    secondsPerDay,
    gatPercentage,
    inflationRate,
    rewardsExpirationTimeout,
    votingToken.address,
    finder.address,
    timerAddress,
    { from: keys.deployer }
  );

  await finder.changeImplementationAddress(web3.utils.utf8ToHex(interfaceName.Oracle), voting.address, {
    from: keys.deployer
  });
  await finder.changeImplementationAddress(
    web3.utils.utf8ToHex(interfaceName.IdentifierWhitelist),
    identifierWhitelist.address,
    {
      from: keys.deployer
    }
  );

  // Corresponds to VotingToken.Roles.Minter.
  const minterRoleEnumValue = 1;

  // Set the minter to be the Voting contract.
  await votingToken.addMember(minterRoleEnumValue, voting.address, { from: keys.deployer });
};
