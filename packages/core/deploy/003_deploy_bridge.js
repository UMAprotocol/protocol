const { interfaceName, getBridgeChainId } = require("@uma/common");
const func = async function(hre) {
  const { deployments, getNamedAccounts, getChainId, web3 } = hre;
  const { utf8ToHex, padRight } = web3.utils;
  const { deploy, log, execute } = deployments;

  const { deployer } = await getNamedAccounts();

  const chainId = await getChainId();
  const bridgeId = getBridgeChainId(chainId);

  const args = [
    bridgeId, // Current chain ID.
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
      padRight(utf8ToHex(interfaceName.Bridge), 64),
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
