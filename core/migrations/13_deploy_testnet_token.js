const TestnetERC20 = artifacts.require("TestnetERC20");
const { deploy, setToExistingAddress } = require("../../common/MigrationUtils.js");
const publicNetworks = require("../../common/PublicNetworks.js");

module.exports = async function(deployer, network, accounts) {
  let preAssignedAddress = null;

  for (const { name, daiAddress } of Object.values(publicNetworks)) {
    if (network.startsWith(name) && daiAddress) {
      await setToExistingAddress(network, TestnetERC20, preAssignedAddress);
      return;
    }
  }

  // Deploy if the network isn't public or if there was no listed DAI address.
  await deploy(deployer, network, TestnetERC20);
};
