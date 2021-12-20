const func = async function (hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();
  const Finder = await deployments.get("Finder");

  await deploy("DesignatedVotingFactory", {
    from: deployer,
    args: [Finder.address],
    log: true,
    skipIfAlreadyDeployed: true,
  });
};
module.exports = func;
func.tags = ["DesignatedVotingFactory", "dvm"];
func.dependencies = ["Finder"];
