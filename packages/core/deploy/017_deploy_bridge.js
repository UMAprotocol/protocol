const { getBridgeChainId } = require("@uma/common");
const func = async function (hre) {
  const { deployments, getNamedAccounts, getChainId } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const chainId = await getChainId();
  const bridgeId = getBridgeChainId(chainId);

  const args = [
    bridgeId, // Current chain ID.
    [deployer], // Initial relayers defaults to deployer as 1 of 1
    1, // Relayer threshold set to 1
    0, // Deposit fee
    100, // # of blocks after which a proposal expires
  ];
  await deploy("Bridge", { from: deployer, args, log: true, skipIfAlreadyDeployed: true });
};
module.exports = func;
func.tags = ["Bridge", "bridge-l2", "bridge-l1"];
