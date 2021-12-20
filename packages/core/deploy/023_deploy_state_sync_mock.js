const func = async function (hre) {
  const { getNamedAccounts, deployments } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();
  await deploy("StateSyncMock", { from: deployer, args: [], log: true, skipIfAlreadyDeployed: true });
};
module.exports = func;
func.tags = ["StateSyncMock", "test"];
module.exports.dependencies = [];
