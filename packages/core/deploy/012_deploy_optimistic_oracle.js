const { ZERO_ADDRESS } = require("@uma/common");
const func = async function (hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  // 2 hours.
  const defaultLiveness = 7200;
  const Finder = await deployments.get("Finder");

  await deploy("OptimisticOracle", {
    from: deployer,
    args: [defaultLiveness, Finder.address, ZERO_ADDRESS],
    log: true,
  });
};
module.exports = func;
func.tags = ["OptimisticOracle", "dvm"];
func.dependencies = ["Finder"];
