const func = async function (hre) {
  // This migration will fail if contracts the bridge admin depend on are not registered in the Finder. No tests depend
  // on this migration so we can continue in this case enabling us to use this in production and skipping in tests.

  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const Finder = await deployments.get("Finder");

  const args = [
    Finder.address, // Finder address
    1800, // optimisticOracleLiveness of 30 mins
    hre.web3.utils.toWei("0.01"), // 1% of relayed funds must be bonded by the proposer
    hre.web3.utils.padRight(hre.web3.utils.utf8ToHex("IS_CROSS_CHAIN_RELAY_VALID"), 64), // price identifier to validate bridging action
  ];

  await deploy("BridgeAdmin", { from: deployer, args, log: true, skipIfAlreadyDeployed: true });
};
module.exports = func;
func.tags = ["BridgeAdmin"];
func.dependencies = ["Finder"];
