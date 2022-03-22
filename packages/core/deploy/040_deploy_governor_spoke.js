const func = async function (hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const finder = await deployments.get("Finder");
  console.log(`Using finder @ ${finder.address}`);

  await deploy("GovernorSpoke", { from: deployer, args: [finder.address], log: true, skipIfAlreadyDeployed: true });
};
module.exports = func;
func.tags = ["GovernorSpoke", "l2-arbitrum-xchain", "l2-boba-xchain", "l2-optimism-xchain", "l2-admin-xchain"];
func.dependencies = ["Finder"];
