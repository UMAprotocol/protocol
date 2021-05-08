const { stringToBytes32, interfaceName } = require("@uma/common");
const func = async function(hre) {
  const { deployments, getNamedAccounts, getChainId } = hre;
  const { deploy, log, execute } = deployments;

  const { deployer } = await getNamedAccounts();

  const chainId = await getChainId();

  const args = [
    chainId, // Current chain ID.
    [deployer], // Initial relayers defaults to deployer as 1 of 1
    1, // Relayer threshold set to 1
    0, // Deposit fee
    100 // # of blocks after which a proposal expires
  ];
  const deployResult = await deploy("Bridge", {
    from: deployer,
    args,
    log: true
  });

  if (deployResult.newlyDeployed) {
    const txn = await execute(
      "Finder",
      { from: deployer },
      "changeImplementationAddress",
      stringToBytes32(interfaceName.Bridge),
      deployResult.address
    );
    log(
      `Set ${interfaceName.Bridge} in Finder to deployed instance @ ${deployResult.address}, tx: ${txn.transactionHash}`
    );
  }
};
module.exports = func;
func.tags = ["Bridge", "sink-oracle", "source-oracle"];
func.dependencies = ["Finder"];
