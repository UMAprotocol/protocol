const { stringToBytes32, interfaceName } = require("@uma/common");
const func = async function(hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, log, execute } = deployments;

  const { deployer } = await getNamedAccounts();

  const deployResult = await deploy("IdentifierWhitelist", {
    from: deployer,
    args: [],
    log: true
  });

  if (deployResult.newlyDeployed) {
    const txn = await execute(
      "Finder",
      { from: deployer },
      "changeImplementationAddress",
      stringToBytes32(interfaceName.IdentifierWhitelist),
      deployResult.address
    );
    log(
      `Set ${interfaceName.IdentifierWhitelist} in Finder to deployed instance @ ${deployResult.address}, tx: ${txn.transactionHash}`
    );
  }
};
module.exports = func;
func.tags = ["IdentifierWhitelist"];
func.dependencies = ["Finder"];
