const { stringToBytes32, interfaceName, ZERO_ADDRESS } = require("@uma/common")

const func = async function(hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, log, execute } = deployments;

  const { deployer } = await getNamedAccounts();

  const Finder = await deployments.get("Finder");

  const args = [Finder.address, ZERO_ADDRESS];
  const deployResult = await deploy("MockOracleAncillary", {
    from: deployer,
    args,
    log: true
  });

  if (deployResult.newlyDeployed) {
    const txn = await execute(
      "Finder",
      { from: deployer },
      "changeImplementationAddress",
      stringToBytes32(interfaceName.MockOracleAncillary),
      deployResult.address
    )
    log(
      `Set ${interfaceName.MockOracleAncillary} in Finder to deployed instance @ ${deployResult.address}, tx: ${txn.transactionHash}`
    );
  }
};
module.exports = func;
func.tags = ["MockOracle"];
func.dependencies = ["Finder"];
