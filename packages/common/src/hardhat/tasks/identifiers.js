const { task, types } = require("hardhat/config");

const _whitelistIdentifier = async (web3, identifierUtf8, identifierWhitelist, deployer) => {
  const { padRight, utf8ToHex } = web3.utils;
  const identifierBytes = padRight(utf8ToHex(identifierUtf8), 64);
  if (!(await identifierWhitelist.methods.isIdentifierSupported(identifierBytes).call())) {
    const txn = await identifierWhitelist.methods.addSupportedIdentifier(identifierBytes).send({ from: deployer });
    console.log(`Whitelisted new identifier: ${identifierUtf8}, tx: ${txn.transactionHash}`);
  } else {
    console.log(`${identifierUtf8} is already approved.`);
  }
};

task("whitelist-identifiers", "Whitelist identifiers from JSON file")
  .addParam("id", "Custom identifier to whitelist", "Test Identifier", types.string)
  .setAction(async function(taskArguments, hre) {
    const { deployments, getNamedAccounts, web3 } = hre;
    const { deployer } = await getNamedAccounts();
    const { id } = taskArguments;

    const IdentifierWhitelist = await deployments.get("IdentifierWhitelist");
    const identifierWhitelist = new web3.eth.Contract(IdentifierWhitelist.abi, IdentifierWhitelist.address);
    console.log(`Using IdentifierWhitelist @ ${identifierWhitelist.options.address}`);

    await _whitelistIdentifier(web3, id, identifierWhitelist, deployer);
  });
