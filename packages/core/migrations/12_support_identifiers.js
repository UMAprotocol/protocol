const IdentiferWhitelist = artifacts.require("IdentifierWhitelist");
const { getKeysForNetwork } = require("@uma/common");
const identifiers = require("../config/identifiers");

module.exports = async function (deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  const supportedIdentifiers = await IdentiferWhitelist.deployed();

  for (const identifier of Object.keys(identifiers)) {
    const identifierBytes = web3.utils.utf8ToHex(identifier);
    await supportedIdentifiers.addSupportedIdentifier(identifierBytes, { from: keys.deployer });
  }
};
