const { getBridgeChainId } = require("@uma/common");

const func = async function(hre) {
  const { deployments, getNamedAccounts, getChainId } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const chainId = await getChainId();
  const bridgeId = getBridgeChainId(chainId);
  const Finder = await deployments.get("Finder");

  const args = [
    Finder.address,
    bridgeId // Current chain ID.
  ];
  await deploy("SourceOracle", {
    from: deployer,
    args,
    log: true
  });
};
module.exports = func;
func.tags = ["SourceOracle", "source-oracle"];
func.dependencies = ["Finder"];
