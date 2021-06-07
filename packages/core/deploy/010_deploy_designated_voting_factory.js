const func = async function (hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();
  const Finder = await deployments.get("Finder");

  await deploy("Governor", {
    from: deployer,
    args: [Finder.address, Finder.address],
    log: true,
  });
};
module.exports = func;
func.tags = ["DesignatedVotingFactory", "dvm"];
func.dependencies = ["Finder"];
