const func = async function (hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const OracleRootTunnel = await deployments.get("OracleRootTunnel");

  const args = [OracleRootTunnel.address];
  await deploy("RootTunnelChunkedRelayer", { from: deployer, args, log: true, skipIfAlreadyDeployed: true });
};
module.exports = func;
func.tags = ["RootTunnelChunkedRelayer", "l1-polygon"];
func.dependencies = ["OracleRootTunnel"];
