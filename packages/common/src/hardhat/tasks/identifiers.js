const { task, types } = require("hardhat/config");
const { waitForTxn } = require("./utils");
const { stringToBytes32 } = require("../../Ethers");

const _whitelistIdentifier = async (identifierUtf8, identifierWhitelist) => {
  const identifierBytes = stringToBytes32(identifierUtf8);
  if (!(await identifierWhitelist.isIdentifierSupported(identifierBytes))) {
    const txn = await waitForTxn(identifierWhitelist.addSupportedIdentifier(identifierBytes));
    console.log(`Whitelisted new identifier: ${identifierUtf8}, tx: ${txn.transactionHash}`);
  } else {
    console.log(`${identifierUtf8} is already approved.`);
  }
};

task("whitelist-identifiers", "Whitelist identifiers from JSON file")
  .addParam("id", "Custom identifier to whitelist", "Test Identifier", types.string)
  .setAction(async function(taskArguments, hre) {
    const { deployments, getNamedAccounts, ethers } = hre;
    const { deployer } = await getNamedAccounts();
    const { id } = taskArguments;

    const IdentifierWhitelist = await deployments.get("IdentifierWhitelist");
    const identifierWhitelist = await ethers.getContractAt(
      "IdentifierWhitelist",
      IdentifierWhitelist.address,
      deployer
    );
    console.log(`Using IdentifierWhitelist @ ${identifierWhitelist.address}`);

    await _whitelistIdentifier(id, identifierWhitelist, deployer);
  });
