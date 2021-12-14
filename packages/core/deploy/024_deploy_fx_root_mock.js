const func = async function (hre) {
  const { getNamedAccounts, deployments } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const StateSyncMock = await deployments.get("StateSyncMock");

  await deploy("FxRootMock", { from: deployer, args: [StateSyncMock.address], log: true, skipIfAlreadyDeployed: true });
};
module.exports = func;
func.tags = ["FxRootMock", "test"];
module.exports.dependencies = ["StateSyncMock"];
