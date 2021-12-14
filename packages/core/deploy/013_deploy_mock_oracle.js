const { ZERO_ADDRESS } = require("@uma/common");

const func = async function (hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const Finder = await deployments.get("Finder");
  const Timer = (await deployments.getOrNull("Timer")) || { address: ZERO_ADDRESS };

  const args = [Finder.address, Timer.address];
  await deploy("MockOracleAncillary", { from: deployer, args, log: true, skipIfAlreadyDeployed: true });
};
module.exports = func;
func.tags = ["MockOracle", "test"];
module.exports.dependencies = ["Finder", "Timer"];
