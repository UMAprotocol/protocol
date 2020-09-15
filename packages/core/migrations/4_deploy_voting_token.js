// Set --token_conversion_rate=XX to allow holders of the pre-existing VotingToken to mint 1 new VotingToken for every
// XX of the old VotingTokens they possess at migration time. If this argument is not provided, no migration contract
// will be deployed.
const argv = require("minimist")(process.argv.slice(), { string: ["token_conversion_rate"] });

const VotingToken = artifacts.require("VotingToken");
const TokenMigrator = artifacts.require("TokenMigrator");
const { getKeysForNetwork, deploy } = require("@uma/common");

const minterRoleEnumValue = 1;

const { toWei } = web3.utils;

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  // Get the old address if this isn't the first deployment.
  let oldToken;
  if (VotingToken.isDeployed()) {
    oldToken = await VotingToken.deployed();
  }

  const { didDeploy, contract: newToken } = await deploy(deployer, network, VotingToken, { from: keys.deployer });

  if (argv.token_conversion_rate && didDeploy && oldToken) {
    // Three conditions must be true to migrate old token to new ones:
    // 1. A new VotingToken must be deployed.
    // 2. An old VotingToken must've been overwritten.
    // 3. The --token_conversion_rate command line argument must have been set.
    const conversionRate = web3.utils.toWei(argv.token_conversion_rate, "ether");
    const { contract: tokenMigrator } = await deploy(
      deployer,
      network,
      TokenMigrator,
      { value: conversionRate },
      oldToken.address,
      newToken.address,
      { from: keys.deployer }
    );

    // Allow the tokenMigrator to mint new tokens.
    await newToken.addMember(minterRoleEnumValue, tokenMigrator.address, { from: keys.deployer });
  } else {
    // No migration, so new tokens should be minted.

    // Give the deployment key minting permissions, mint the initial token distribution of 100MM, and then remove the
    // minting priviledges.
    await newToken.addMember(minterRoleEnumValue, keys.deployer, { from: keys.deployer });
    await newToken.mint(keys.deployer, toWei("100000000"), { from: keys.deployer });
    await newToken.removeMember(minterRoleEnumValue, keys.deployer, { from: keys.deployer });
  }
};
