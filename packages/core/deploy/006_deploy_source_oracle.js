const func = async function(hre) {
  const { deployments, getNamedAccounts, getChainId } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const chainId = await getChainId();
  const Finder = await deployments.get("Finder");

  const args = [
    Finder.address,
    chainId // Current chain ID.
  ];
  await deploy("SourceOracle", {
    from: deployer,
    args,
    log: true
  });
};
module.exports = func;
func.tags = ["SourceOracle","production","source-oracle"];
func.dependencies = ["Finder"];
