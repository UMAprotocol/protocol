const { ZERO_ADDRESS } = require("@uma/common");
const func = async function (hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();
  const Timer = (await deployments.getOrNull("Timer")) || { address: ZERO_ADDRESS };
  const Finder = await deployments.get("Finder");

  const startingProposalId = 0;

  await deploy("Governor", {
    from: deployer,
    args: [Finder.address, startingProposalId, Timer.address],
    log: true,
    skipIfAlreadyDeployed: true,
  });
};
module.exports = func;
func.tags = ["Governor", "dvm"];
func.dependencies = ["Finder", "Timer"];
