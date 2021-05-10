const { task, types } = require("hardhat/config");
const { waitForTxn } = require("./utils");
const { stringToBytes32 } = require("@uma/common");
const defaultIdentifiersToWhitelist = require("../../../config/identifiers.json");

const _whitelistIdentifier = async (identifierUtf8, identifierWhitelist, deployer) => {
    const identifierBytes = stringToBytes32(identifierUtf8);
    if (!(await identifierWhitelist.isIdentifierSupported(identifierBytes))) {
        const txn = await waitForTxn(identifierWhitelist.addSupportedIdentifier(identifierBytes, { from: deployer }));
        console.log(
            `Whitelisted new identifier: ${identifierUtf8}, tx: ${txn.transactionHash}`
        );
    } else {
        console.log(`${identifierUtf8} is already approved.`);
    }
}

task("whitelist-identifiers", "Whitelist identifiers from JSON file")
    .addOptionalParam("id", "Custom identifier to whitelist", "", types.string)
    .setAction(async function(taskArguments, hre) {
        const { deployments, getNamedAccounts, ethers } = hre;
        const { deployer } = await getNamedAccounts();
        const { id } = taskArguments;

        const IdentifierWhitelist = await deployments.get("IdentifierWhitelist");
        const identifierWhitelist = await ethers.getContractAt("IdentifierWhitelist", IdentifierWhitelist.address)
        console.log(`Using IdentifierWhitelist @ ${identifierWhitelist.address}`);

        // Whitelist custom identifiers.
        if (id !== "") {
            await _whitelistIdentifier(id, identifierWhitelist, deployer)
        }

        // Whitelist default list of identifiers from file.
        for (const identifier of Object.keys(defaultIdentifiersToWhitelist)) {
            await _whitelistIdentifier(identifier, identifierWhitelist, deployer)
        }
    }
);
