const { ZERO_ADDRESS } = require("@uma/common");

const func = async function (hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const Timer = (await deployments.getOrNull("Timer")) || { address: ZERO_ADDRESS };
  const VotingToken = await deployments.get("VotingToken");
  const Finder = await deployments.get("Finder");
  const SlashingLibrary = await deployments.get("SlashingLibrary");

  // Set the GAT percentage to 5%
  const gatPercentage = { rawValue: hre.web3.utils.toWei("0.05", "ether") };

  // Set the inflation rate.
  const emissionRate = "640000000000000000";

  const unstakeCooldown = 60 * 60 * 24 * 7; // 7 days

  // Set phase length to one day.
  const phaseLength = "86400";

  // If a price request falls in the last 2 hours of the previous reveal phase then auto roll it to the next round.
  const minRollToNextRoundLength = "7200";

  await deploy("VotingV2", {
    from: deployer,
    args: [
      emissionRate,
      unstakeCooldown,
      phaseLength,
      minRollToNextRoundLength,
      gatPercentage,
      VotingToken.address,
      Finder.address,
      Timer.address,
      SlashingLibrary.address,
    ],
    log: true,
    skipIfAlreadyDeployed: true,
  });
};
module.exports = func;
func.tags = ["dvmv2"];
func.dependencies = ["VotingToken", "Finder", "Timer", "SlashingLibrary"];
