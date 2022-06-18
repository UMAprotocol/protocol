const { ZERO_ADDRESS } = require("@uma/common");

const func = async function (hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const Timer = (await deployments.getOrNull("Timer")) || { address: ZERO_ADDRESS };
  const VotingToken = await deployments.get("VotingToken");
  const Finder = await deployments.get("Finder");

  // Set the GAT percentage to 5%
  const gatPercentage = { rawValue: hre.web3.utils.toWei("0.05", "ether") };

  // Set the inflation rate.
  const inflationRate = { rawValue: hre.web3.utils.toWei("0.0005", "ether") };

  // Set the rewards expiration timeout.
  const rewardsExpirationTimeout = 60 * 60 * 24 * 14; // Two weeks.

  // Set phase length to one day.
  const phaseLength = "86400";

  await deploy("Voting", {
    from: deployer,
    args: [
      phaseLength,
      gatPercentage,
      inflationRate,
      rewardsExpirationTimeout,
      VotingToken.address,
      Finder.address,
      Timer.address,
    ],
    log: true,
    skipIfAlreadyDeployed: true,
  });
};
module.exports = func;
func.tags = ["dvm"];
func.dependencies = ["VotingToken", "Finder", "Timer"];
