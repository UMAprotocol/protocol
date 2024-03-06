const func = async function (hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();
  const Finder = await deployments.get("Finder");

  await deploy("DesignatedVotingV2Factory", {
    from: deployer,
    args: [Finder.address],
    log: true,
    skipIfAlreadyDeployed: true,
  });
};
module.exports = func;
func.tags = ["DesignatedVotingV2Factory", "dvm", "dvmv2"];
func.dependencies = ["Finder"];
