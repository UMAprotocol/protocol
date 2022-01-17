const { ZERO_ADDRESS } = require("@uma/common");

const func = async function (hre) {
  const { deployments, getNamedAccounts, web3 } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const Finder = await deployments.get("Finder");
  const Governor = await deployments.get("Governor");
  const VotingToken = await deployments.get("VotingToken");
  const Timer = (await deployments.getOrNull("Timer")) || { address: ZERO_ADDRESS };

  const defaultBond = web3.utils.toWei("5000");

  await deploy("Proposer", {
    from: deployer,
    args: [VotingToken.address, defaultBond, Governor.address, Finder.address, Timer.address],
    log: true,
    skipIfAlreadyDeployed: true,
  });
};
module.exports = func;
func.tags = ["Proposer", "dvm"];
func.dependencies = ["Finder", "VotingToken", "Governor", "Timer"];
