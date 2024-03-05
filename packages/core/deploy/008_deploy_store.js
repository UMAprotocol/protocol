const { ZERO_ADDRESS } = require("@uma/common");
const func = async function (hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();
  const Timer = (await deployments.getOrNull("Timer")) || { address: ZERO_ADDRESS };

  // Initialize both fees to 0.
  const initialFixedOracleFeePerSecondPerPfc = { rawValue: "0" };
  const initialWeeklyDelayFeePerSecondPerPfc = { rawValue: "0" };

  await deploy("Store", {
    from: deployer,
    args: [initialFixedOracleFeePerSecondPerPfc, initialWeeklyDelayFeePerSecondPerPfc, Timer.address],
    log: true,
    skipIfAlreadyDeployed: true,
  });
};
module.exports = func;
func.tags = ["Store", "dvm", "dvmv2"];
func.dependencies = ["Timer"];
