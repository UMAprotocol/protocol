import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
const { stringToBytes32, interfaceName } = require("@uma/common");

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, execute } = deployments;

  const { deployer } = await getNamedAccounts();

  const deployResult = await deploy("Registry", {
    from: deployer,
    args: [],
    log: true
  });

  if (deployResult.newlyDeployed) {
    await execute("Finder", { from: deployer }, "changeImplementationAddress", [
      stringToBytes32(interfaceName.Registry),
      deployResult.address
    ]);
  }
};
export default func;
func.tags = ["Registry"];
func.dependencies = ["Finder"];
