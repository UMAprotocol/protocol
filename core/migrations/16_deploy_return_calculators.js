const LeveragedReturnCalculator = artifacts.require("LeveragedReturnCalculator");
const AddressWhitelist = artifacts.require("AddressWhitelist");
const TokenizedDerivativeCreator = artifacts.require("TokenizedDerivativeCreator");
const { getKeysForNetwork, deploy, addToTdr } = require("../../common/MigrationUtils.js");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  // Deploy return calculators for 1x and 2x cases. Note: must leave the 1x for last so it's the default return
  // calculator contract in truffle.
  const { contract: levered2x } = await deploy(deployer, network, LeveragedReturnCalculator, 2, {
    from: keys.deployer
  });
  const { contract: levered1x } = await deploy(deployer, network, LeveragedReturnCalculator, 1, {
    from: keys.deployer
  });

  // Grab the whitelist.
  const tokenizedDerivativeCreator = await TokenizedDerivativeCreator.deployed();
  const returnCalculatorWhitelist = await AddressWhitelist.at(
    await tokenizedDerivativeCreator.returnCalculatorWhitelist()
  );

  // Approve the new return calculators on the whitelists.
  await returnCalculatorWhitelist.addToWhitelist(levered2x.address, { from: keys.returnCalculatorWhitelist });
  await returnCalculatorWhitelist.addToWhitelist(levered1x.address, { from: keys.returnCalculatorWhitelist });
};
