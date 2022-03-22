const func = async function (hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  await deploy("GovernorHub", { from: deployer, args: [], log: true, skipIfAlreadyDeployed: true });
};
module.exports = func;
func.tags = ["GovernorHub", "l1-arbitrum-xchain", "l1-boba-xchain", "l1-optimism-xchain"];
