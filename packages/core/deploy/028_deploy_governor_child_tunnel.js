// Grabbed from official Polygon docs
// https://docs.matic.network/docs/develop/l1-l2-communication/state-transfer/#pre-requisite
const ADDRESSES_FOR_NETWORK = {
  80001: { fxChild: "0xCf73231F28B7331BBe3124B907840A94851f9f11" },
  137: { fxChild: "0x8397259c983751DAf40400790063935a11afa28a" },
};
const func = async function (hre) {
  const { deployments, getNamedAccounts, getChainId } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const chainId = await getChainId();

  let args;
  if (ADDRESSES_FOR_NETWORK[chainId]) {
    args = [ADDRESSES_FOR_NETWORK[chainId].fxChild];
  } else {
    // Fall back to mocks if hardhcoded addresses aren't there.
    const FxChildMock = await deployments.get("FxChildMock");
    args = [FxChildMock.address];
  }

  await deploy("GovernorChildTunnel", { from: deployer, args, log: true, skipIfAlreadyDeployed: true });
};
module.exports = func;
func.tags = ["GovernorChildTunnel", "l2-polygon"];
