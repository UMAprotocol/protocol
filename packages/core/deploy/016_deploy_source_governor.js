const { getBridgeChainId } = require("@uma/common");

const func = async function (hre) {
  const { deployments, getNamedAccounts, getChainId } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const chainId = await getChainId();
  const bridgeId = getBridgeChainId(chainId);

  await deploy("SourceGovernor", {
    from: deployer,
    args: ["0x40f941E48A552bF496B154Af6bf55725f18D77c3", bridgeId],
    log: true,
  });
};
module.exports = func;
func.tags = ["SourceGovernor", "bridge-l1"];
func.dependencies = ["Finder"];
