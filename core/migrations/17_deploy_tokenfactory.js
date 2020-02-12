const Finder = artifacts.require("Finder");
const TokenFactory = artifacts.require("TokenFactory");

const { getKeysForNetwork, deploy } = require("../../common/MigrationUtils.js");
const { interfaceName } = require("../utils/Constants.js");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  const { contract: tokenfactory } = await deploy(deployer, network, TokenFactory, { from: keys.deployer });

  const finder = await Finder.deployed();
  await finder.changeImplementationAddress(web3.utils.utf8ToHex(interfaceName.TokenFactory), tokenfactory.address, {
    from: keys.deployer
  });
};
