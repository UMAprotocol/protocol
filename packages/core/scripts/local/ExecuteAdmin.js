// This executes an approved admin proposal. This assumes that the admin proposal is one to whitelist an identifier,
// therefore it will check the identifier whitelist afterwards.

const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const Governor = artifacts.require("Governor");
const assert = require("assert");

async function execute(callback) {
  try {
    const identifierWhitelist = await IdentifierWhitelist.deployed();
    const governor = await Governor.deployed();

    // Get the latest admin proposal
    const proposalId = (await governor.numProposals()).subn(1).toString();
    const proposal = await governor.getProposal(proposalId);

    // for every transactions within the proposal
    for (let i = 0; i < proposal.transactions.length; i++) {
      console.log(`${i}: Submitting tx...`);
      let tx = await governor.executeProposal(proposalId.toString(), i.toString());
      console.log(`${i}: Done: `, tx.tx);
    }

    // Check that the identifier whitelist has been updated.
    assert.equal(await identifierWhitelist.isIdentifierSupported(web3.utils.utf8ToHex("TEST-NEW-IDENTIFIER")), true);

    console.log("Admin proposal to whitelist new identifier executed!");
  } catch (err) {
    console.error(err);
    callback(err);
  }
  callback();
}

module.exports = execute;
