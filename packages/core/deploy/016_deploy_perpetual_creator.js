const { ZERO_ADDRESS } = require("@uma/common");
const func = async function (hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const Finder = await deployments.get("Finder");
  const TokenFactory = await deployments.get("TokenFactory");
  const Timer = (await deployments.getOrNull("Timer")) || ZERO_ADDRESS;

  const PerpetualLib = await deploy("PerpetualLib", { from: deployer, log: true });
  await deploy("PerpetualCreator", {
    from: deployer,
    args: [Finder.address, TokenFactory.address, Timer.address],
    libraries: { PerpetualLib: PerpetualLib.address },
    log: true,
  });
};
module.exports = func;
func.tags = ["PerpetualCreator", "perpetual"];
func.dependencies = ["Finder", "TokenFactory", "Timer"];
