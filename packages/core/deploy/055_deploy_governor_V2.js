const { ZERO_ADDRESS } = require("@uma/common");
const func = async function (hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, save } = deployments;

  const { deployer } = await getNamedAccounts();
  const Timer = (await deployments.getOrNull("Timer")) || { address: ZERO_ADDRESS };
  const Finder = await deployments.get("Finder");

  const startingProposalId = 0;

  if (Timer.address === ZERO_ADDRESS) {
    await deploy("GovernorV2", {
      from: deployer,
      args: [Finder.address, startingProposalId],
      log: true,
      skipIfAlreadyDeployed: true,
    });
  } else {
    const submission = await deploy("GovernorV2Test", {
      from: deployer,
      args: [Finder.address, startingProposalId, Timer.address],
      log: true,
      skipIfAlreadyDeployed: true,
    });

    // Save this under GovernorV2 as well.
    await save("GovernorV2", submission);
  }
};
module.exports = func;
func.tags = ["dvmv2"];
func.dependencies = ["Finder", "Timer"];
