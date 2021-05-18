const { interfaceName } = require("@uma/common");
const func = async function (hre) {
  const { deployments, getNamedAccounts, web3 } = hre;
  const { utf8ToHex, padRight } = web3.utils;
  const { deploy, log, execute } = deployments;

  const { deployer } = await getNamedAccounts();

  const Bridge = await deployments.get("Bridge");

  const args = [Bridge.address, [], [], [], []];
  const deployResult = await deploy("GenericHandler", {
    from: deployer,
    args,
    log: true,
  });

  if (deployResult.newlyDeployed) {
    const txn = await execute(
      "Finder",
      { from: deployer },
      "changeImplementationAddress",
      padRight(utf8ToHex(interfaceName.GenericHandler), 64),
      deployResult.address
    );
    log(
      `Set ${interfaceName.GenericHandler} in Finder to deployed instance @ ${deployResult.address}, tx: ${txn.transactionHash}`
    );
  }
};
module.exports = func;
func.tags = ["GenericHandler", "sink-oracle", "source-oracle"];
func.dependencies = ["Bridge", "Finder"];
