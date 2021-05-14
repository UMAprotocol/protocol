const { interfaceName } = require("@uma/common");
const func = async function(hre) {
  const { deployments, getNamedAccounts, web3 } = hre;
  const { utf8ToHex, padRight } = web3.utils;
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
      padRight(utf8ToHex(interfaceName.IdentifierWhitelist), 64),
      deployResult.address
    );
    log(
      `Set ${interfaceName.IdentifierWhitelist} in Finder to deployed instance @ ${deployResult.address}, tx: ${txn.transactionHash}`
    );
  }
};
module.exports = func;
func.tags = ["IdentifierWhitelist", "dvm"];
func.dependencies = ["Finder"];
