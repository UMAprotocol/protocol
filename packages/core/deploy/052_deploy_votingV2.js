const { ZERO_ADDRESS } = require("@uma/common");

const func = async function (hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, save } = deployments;

  const { deployer } = await getNamedAccounts();

  const Timer = (await deployments.getOrNull("Timer")) || { address: ZERO_ADDRESS };
  const VotingToken = await deployments.get("VotingToken");
  const Finder = await deployments.get("Finder");
  const SlashingLibrary = await deployments.get("SlashingLibrary");

  // Set the GAT percentage to 5%
  const gatPercentage = hre.web3.utils.toWei("0.05", "ether");

  const emissionRate = "640000000000000000"; // 0.64 UMA per second.

  const spamDeletionProposalBond = hre.web3.utils.toWei("10000", "ether"); // 10k UMA to propose to delete spam.

  const unstakeCooldown = 60 * 60 * 24 * 7; // 7 days

  // Set phase length to one day.
  const phaseLength = "86400";

  // If a price request falls in the last 2 hours of the previous reveal phase then auto roll it to the next round.
  const minRollToNextRoundLength = "7200";

  if (Timer.address === ZERO_ADDRESS) {
    await deploy("VotingV2", {
      from: deployer,
      args: [
        emissionRate,
        spamDeletionProposalBond,
        unstakeCooldown,
        phaseLength,
        minRollToNextRoundLength,
        gatPercentage,
        VotingToken.address,
        Finder.address,
        SlashingLibrary.address,
      ],
      log: true,
      skipIfAlreadyDeployed: true,
    });
  } else {
    const submission = await deploy("VotingV2ControllableTiming", {
      from: deployer,
      args: [
        emissionRate,
        spamDeletionProposalBond,
        unstakeCooldown,
        phaseLength,
        minRollToNextRoundLength,
        gatPercentage,
        VotingToken.address,
        Finder.address,
        SlashingLibrary.address,
        Timer.address,
      ],
      log: true,
      skipIfAlreadyDeployed: true,
    });

    // Save this under VotingV2 as well.
    await save("VotingV2", submission);
  }
};
module.exports = func;
func.tags = ["dvmv2"];
func.dependencies = ["VotingToken", "Finder", "Timer", "SlashingLibrary"];
