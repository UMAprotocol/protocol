const { stringToBytes32, interfaceName } = require("@uma/common");
const func = async function(hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, log, execute } = deployments;

  const { deployer } = await getNamedAccounts();

  const deployResult = await deploy("Registry", {
    from: deployer,
    args: [],
    log: true
  });

  if (deployResult.newlyDeployed) {
    const txn = await execute(
      "Finder",
      { from: deployer },
      "changeImplementationAddress",
      stringToBytes32(interfaceName.Registry),
      deployResult.address
    );
    log(
      `Set ${interfaceName.Bridge} in Finder to deployed instance @ ${deployResult.address}, tx: ${txn.transactionHash}`
    );
  }
};
module.exports = func;
func.tags = ["Registry", "dvm", "sink-oracle", "source-oracle"];
func.dependencies = ["Finder"];
