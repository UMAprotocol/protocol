const Voting = artifacts.require("Voting");
const { getKeysForNetwork } = require("../../common/MigrationUtils.js");
const identifiers = require("../config/identifiers");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  const voting = await Voting.deployed();

  for (const identifier of Object.keys(identifiers)) {
    const identifierBytes = web3.utils.utf8ToHex(identifier);
    await voting.addSupportedIdentifier(identifierBytes, { from: keys.deployer });
  }
};
