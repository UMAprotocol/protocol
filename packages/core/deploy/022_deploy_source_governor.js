const { getBridgeChainId } = require("@uma/common");

const func = async function (hre) {
  const { deployments, getNamedAccounts, getChainId } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const chainId = await getChainId();
  const bridgeId = getBridgeChainId(chainId);

  const Finder = await deployments.get("Finder");

  await deploy("SourceGovernor", {
    from: deployer,
    args: [Finder.address, bridgeId],
    log: true,
    skipIfAlreadyDeployed: true,
  });
};
module.exports = func;
func.tags = ["SourceGovernor", "l1-chainbridge"];
func.dependencies = ["Finder"];
