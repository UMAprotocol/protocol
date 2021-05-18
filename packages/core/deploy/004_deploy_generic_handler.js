const func = async function (hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const Bridge = await deployments.get("Bridge");

  const args = [Bridge.address, [], [], [], []];
  await deploy("GenericHandler", {
    from: deployer,
    args,
    log: true,
  });
};
module.exports = func;
func.tags = ["GenericHandler", "sink-oracle", "source-oracle"];
func.dependencies = ["Bridge"];
