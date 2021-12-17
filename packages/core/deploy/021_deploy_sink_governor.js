const func = async function (hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const Finder = await deployments.get("Finder");

  await deploy("SinkGovernor", { from: deployer, args: [Finder.address], log: true, skipIfAlreadyDeployed: true });
};
module.exports = func;
func.tags = ["SinkGovernor", "l2-chainbridge"];
func.dependencies = ["Finder", "Registry"];
