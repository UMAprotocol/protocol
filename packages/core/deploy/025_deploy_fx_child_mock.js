const func = async function (hre) {
  const { getNamedAccounts, deployments } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  await deploy("FxChildMock", {
    from: deployer,
    args: [deployer], // Set deployer as the systemSuperUser.
    log: true,
    skipIfAlreadyDeployed: true,
  });
};
module.exports = func;
func.tags = ["FxChildMock", "test"];
module.exports.dependencies = [];
