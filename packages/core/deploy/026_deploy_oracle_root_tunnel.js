// Grabbed from official Polygon docs
// https://docs.matic.network/docs/develop/l1-l2-communication/state-transfer/#pre-requisite
const ADDRESSES_FOR_NETWORK = {
  5: {
    checkpointManager: "0x2890bA17EfE978480615e330ecB65333b880928e",
    fxRoot: "0x3d1d3E34f7fB6D26245E6640E1c50710eFFf15bA",
  },
  1: {
    checkpointManager: "0x86e4dc95c7fbdbf52e33d563bbdb00823894c287",
    fxRoot: "0xfe5e5D361b2ad62c541bAb87C45a0B9B018389a2",
  },
};
const func = async function (hre) {
  const { deployments, getNamedAccounts, getChainId } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const chainId = await getChainId();
  const Finder = await deployments.get("Finder");

  let args;
  if (ADDRESSES_FOR_NETWORK[chainId]) {
    args = [ADDRESSES_FOR_NETWORK[chainId].checkpointManager, ADDRESSES_FOR_NETWORK[chainId].fxRoot, Finder.address];
  } else {
    // Fall back to mocks if hardhcoded addresses aren't there.
    const FxRootMock = await deployments.get("FxRootMock");
    args = [deployer, FxRootMock.address, Finder.address]; // Note: uses deployer as the checkpoint manager.
  }

  await deploy("OracleRootTunnel", { from: deployer, args, log: true, skipIfAlreadyDeployed: true });
};
module.exports = func;
func.tags = ["OracleRootTunnel", "l1-polygon"];
