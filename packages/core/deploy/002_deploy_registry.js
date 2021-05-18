const { interfaceName } = require("@uma/common");
const func = async function (hre) {
  const { deployments, getNamedAccounts, web3 } = hre;
  const { utf8ToHex, padRight } = web3.utils;
  const { deploy, log, execute } = deployments;

  const { deployer } = await getNamedAccounts();

  const deployResult = await deploy("Registry", {
    from: deployer,
    args: [],
    log: true,
  });

  if (deployResult.newlyDeployed) {
    const txn = await execute(
      "Finder",
      { from: deployer },
      "changeImplementationAddress",
      padRight(utf8ToHex(interfaceName.Registry), 64),
      deployResult.address
    );
    log(
      `Set ${interfaceName.Registry} in Finder to deployed instance @ ${deployResult.address}, tx: ${txn.transactionHash}`
    );
  }
};
module.exports = func;
func.tags = ["Registry", "dvm", "sink-oracle", "source-oracle"];
func.dependencies = ["Finder"];
