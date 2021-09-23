const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const identifiers = require("../../config/identifiers");

const approveIdentifiers = async function (callback) {
  try {
    const deployer = (await web3.eth.getAccounts())[0];

    const supportedIdentifiers = await IdentifierWhitelist.deployed();

    for (const identifier of Object.keys(identifiers)) {
      const identifierBytes = web3.utils.utf8ToHex(identifier);
      if (!(await supportedIdentifiers.isIdentifierSupported(identifierBytes))) {
        await supportedIdentifiers.addSupportedIdentifier(identifierBytes, { from: deployer });
        console.log(`Approved new identifier: ${identifier}`);
      } else {
        console.log(`${identifier} is already approved.`);
      }
    }
  } catch (e) {
    console.log(`ERROR: ${e}`);
  }

  callback();
};

module.exports = approveIdentifiers;
