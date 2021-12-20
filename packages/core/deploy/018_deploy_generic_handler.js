const func = async function (hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const Bridge = await deployments.get("Bridge");

  const args = [Bridge.address, [], [], [], []];
  await deploy("GenericHandler", { from: deployer, args, log: true, skipIfAlreadyDeployed: true });
};
module.exports = func;
func.tags = ["GenericHandler", "bridge-l2", "bridge-l1"];
func.dependencies = ["Bridge"];
