const { ZERO_ADDRESS } = require("@uma/common");
const func = async function (hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  // 2 hours.
  const defaultLiveness = 7200;
  const Finder = await deployments.get("Finder");
  const Timer = (await deployments.getOrNull("Timer")) || { address: ZERO_ADDRESS };

  await deploy("SkinnyOptimisticOracle", {
    from: deployer,
    args: [defaultLiveness, Finder.address, Timer.address],
    log: true,
    skipIfAlreadyDeployed: true,
  });
};
module.exports = func;
func.tags = ["SkinnyOptimisticOracle", "dvm"];
func.dependencies = ["Finder", "Timer"];
