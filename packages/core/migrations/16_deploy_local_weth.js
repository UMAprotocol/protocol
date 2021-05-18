const WETH9 = artifacts.require("WETH9");
const AddressWhitelist = artifacts.require("AddressWhitelist");
const { deploy, setToExistingAddress, getKeysForNetwork, PublicNetworks } = require("@uma/common");

module.exports = async function (deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  let wethTokenAddress = null;

  for (const { name, wethAddress } of Object.values(PublicNetworks)) {
    if (network.startsWith(name) && wethAddress) {
      await setToExistingAddress(network, WETH9, wethAddress);
      wethTokenAddress = wethAddress;
      break;
    }
  }

  if (!wethTokenAddress) {
    // Deploy if the network isn't public or if there was no listed WETH address.
    ({
      contract: { address: wethTokenAddress },
    } = await deploy(deployer, network, WETH9, { from: keys.deployer }));
  }

  // Add wethTokenAddress to the margin currency whitelist.
  const collateralWhitelist = await AddressWhitelist.deployed();
  await collateralWhitelist.addToWhitelist(wethTokenAddress, { from: keys.deployer });
};
