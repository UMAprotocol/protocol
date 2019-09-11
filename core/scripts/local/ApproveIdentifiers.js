const Voting = artifacts.require("Voting");
const identifiers = require("../../config/identifiers");

const approveIdentifiers = async function(callback) {
  try {
    const deployer = (await web3.eth.getAccounts())[0];

    const voting = await Voting.deployed();

    for (const identifier of Object.keys(identifiers)) {
      const identifierBytes = web3.utils.utf8ToHex(identifier);
      if (!(await voting.isIdentifierSupported(identifierBytes))) {
        await voting.addSupportedIdentifier(identifierBytes, { from: deployer });
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
