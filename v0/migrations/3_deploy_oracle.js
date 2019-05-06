const Registry = artifacts.require("Registry");
const CentralizedOracle = artifacts.require("CentralizedOracle");
const {
  getKeysForNetwork,
  enableControllableTiming,
  deployAndGet,
  addToTdr
} = require("../../common/MigrationUtils.js");
const identifiers = require("../config/identifiers");

module.exports = async function(deployer, network, accounts) {
  const controllableTiming = enableControllableTiming(network);
  const keys = getKeysForNetwork(network, accounts);

  const registry = await Registry.deployed();

  // TODO: possibly update the oracle owner once we integrate hardware wallets.
  const centralizedOracle = await deployAndGet(deployer, CentralizedOracle, registry.address, controllableTiming, {
    from: keys.deployer
  });
  await addToTdr(centralizedOracle, network);

  // Add supported identifiers to the Oracle.
  const supportedIdentifiers = Object.keys(identifiers);
  for (let identifier of supportedIdentifiers) {
    const identifierBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex(identifier));
    await centralizedOracle.addSupportedIdentifier(identifierBytes, { from: keys.deployer });
  }
};
