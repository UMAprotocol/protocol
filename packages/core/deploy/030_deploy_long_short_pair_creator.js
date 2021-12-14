const { ZERO_ADDRESS } = require("@uma/common");
const func = async function (hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const Finder = await deployments.get("Finder");
  const TokenFactory = await deployments.get("TokenFactory");
  const Timer = (await deployments.getOrNull("Timer")) || { address: ZERO_ADDRESS };

  await deploy("LongShortPairCreator", {
    from: deployer,
    args: [Finder.address, TokenFactory.address, Timer.address],
    log: true,
    skipIfAlreadyDeployed: true,
  });
};
module.exports = func;
func.tags = ["LongShortPairCreator", "lsp"];
func.dependencies = ["Finder", "TokenFactory", "Timer"];
