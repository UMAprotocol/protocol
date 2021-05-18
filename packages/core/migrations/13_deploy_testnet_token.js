const TestnetERC20 = artifacts.require("TestnetERC20");
const { deploy, setToExistingAddress, getKeysForNetwork, PublicNetworks } = require("@uma/common");

module.exports = async function (deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  let testnetERC20Address = null;

  for (const { name, daiAddress } of Object.values(PublicNetworks)) {
    if (network.startsWith(name) && daiAddress) {
      await setToExistingAddress(network, TestnetERC20, daiAddress);
      testnetERC20Address = daiAddress;
      break;
    }
  }

  if (!testnetERC20Address) {
    // Deploy if the network isn't public or if there was no listed DAI address.
    ({
      contract: { address: testnetERC20Address },
    } = await deploy(deployer, network, TestnetERC20, "Dai Stable Coin", "DAI", 18, { from: keys.deployer }));
  }
};
