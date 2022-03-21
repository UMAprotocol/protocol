const func = async function (hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  await deploy("RateModelStore", { from: deployer, args: [], log: true, skipIfAlreadyDeployed: true });
};
module.exports = func;
func.tags = ["RateModelStore"];
