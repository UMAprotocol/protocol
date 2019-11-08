const TestnetERC20 = artifacts.require("TestnetERC20");
const TokenizedDerivativeCreator = artifacts.require("TokenizedDerivativeCreator");
const AddressWhitelist = artifacts.require("AddressWhitelist");
const { deploy, setToExistingAddress, getKeysForNetwork } = require("../../common/MigrationUtils.js");
const publicNetworks = require("../../common/PublicNetworks.js");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  let testnetERC20Address = null;

  for (const { name, daiAddress } of Object.values(publicNetworks)) {
    if (network.startsWith(name) && daiAddress) {
      await setToExistingAddress(network, TestnetERC20, daiAddress);
      testnetERC20Address = daiAddress;
      break;
    }
  }

  if (!testnetERC20Address) {
    // Deploy if the network isn't public or if there was no listed DAI address.
    ({
      contract: { address: testnetERC20Address }
    } = await deploy(deployer, network, TestnetERC20, { from: keys.deployer }));
  }

  // Add testnetERC20 to the margin currency whitelist.
  const tokenizedDerivativeCreator = await TokenizedDerivativeCreator.deployed();
  const marginCurrencyWhitelistAddress = await tokenizedDerivativeCreator.marginCurrencyWhitelist();
  const marginCurrencyWhitelist = await AddressWhitelist.at(marginCurrencyWhitelistAddress);
  await marginCurrencyWhitelist.addToWhitelist(testnetERC20Address, { from: keys.marginCurrencyWhitelist });
};
