const { stringToBytes32, interfaceName } = require("@uma/common");
const func = async function(hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, log, execute } = deployments;

  const { deployer } = await getNamedAccounts();

  const Bridge = await deployments.get("Bridge");

  const args = [Bridge.address, [], [], [], []];
  const deployResult = await deploy("GenericHandler", {
    from: deployer,
    args,
    log: true
  });

  if (deployResult.newlyDeployed) {
    const txn = await execute(
      "Finder",
      { from: deployer },
      "changeImplementationAddress",
      stringToBytes32(interfaceName.GenericHandler),
      deployResult.address
    );
    log(
      `Set ${interfaceName.GenericHandler} in Finder to deployed instance @ ${deployResult.address}, tx: ${txn.transactionHash}`
    );
  }
};
module.exports = func;
func.tags = ["GenericHandler", "production", "sink-oracle", "source-oracle"];
func.dependencies = ["Bridge", "Finder"];
