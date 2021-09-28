// This deploy script should be run on an optimism provider.
const { getAddress } = require("@uma/contracts-node");
const { ZERO_ADDRESS } = require("@uma/common");
const func = async function (hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();
  const chainId = await web3.eth.net.getId();

  if (chainId != "69" || chainId != "10") throw new Error("This deploy only works on optimism chains");

  // Map L2 chain IDs to L1 chain IDs to find associated bridgeAdmin addresses for a given L2 chain ID.
  const l2ChainIdToL1 = {
    69: 42, // optimism testnet -> kovan
    10: 1, // optimism mainnet -> mainnet
  };

  const bridgeAdminAddress = await getAddress("BridgeAdmin", l2ChainIdToL1[chainId]);

  const args = [
    bridgeAdminAddress,
    1800, // minimumBridgingDelay of 30 mins
    chainId, // chainId of the L2 being deployed on
    ZERO_ADDRESS, // timer address
  ];

  await deploy("OVM_BridgeDepositBox", { from: deployer, args, log: true });
};
module.exports = func;
func.tags = ["OVM_BridgeDepositBox"];
