const WETH9 = artifacts.require("WETH9");
const AddressWhitelist = artifacts.require("AddressWhitelist");
const ExpiringMultiPartyCreator = artifacts.require("ExpiringMultiPartyCreator");
const { deploy, setToExistingAddress, getKeysForNetwork } = require("../../common/MigrationUtils.js");
const publicNetworks = require("../../common/PublicNetworks.js");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  let wethTokenAddress = null;

  for (const { name, wethAddress } of Object.values(publicNetworks)) {
    if (network.startsWith(name) && wethAddress) {
      await setToExistingAddress(network, WETH9, wethAddress);
      wethTokenAddress = wethAddress;
      break;
    }
  }

  if (!wethTokenAddress) {
    // Deploy if the network isn't public or if there was no listed WETH address.
    ({
      contract: { address: wethTokenAddress }
    } = await deploy(deployer, network, WETH9, { from: keys.deployer }));
  }

  // Add wethTokenAddress to the margin currency whitelist.
  const empCreator = await ExpiringMultiPartyCreator.deployed();
  const collateralWhitelistAddress = await empCreator.collateralTokenWhitelist();
  const collateralWhitelist = await AddressWhitelist.at(collateralWhitelistAddress);
  await collateralWhitelist.addToWhitelist(wethTokenAddress, { from: keys.deployer });
};
