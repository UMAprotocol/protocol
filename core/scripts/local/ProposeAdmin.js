// This script proposes a contrived admin proposal to the DVM. Specifically, its a proposal to whitelist
// a new price identifier.

// @dev: This script will FAIL if the caller (i.e. web3.accounts[0]) does not hold the PROPOSER role in the Governor contract
// @dev: This script will have the side effect of making the Governor contract the owner of the IdentifierWhitelist.

const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const Governor = artifacts.require("Governor");
const assert = require("assert");

async function propose(callback) {
  try {
    const identifierWhitelist = await IdentifierWhitelist.deployed();
    const governor = await Governor.deployed();

    // The `proposedTx` will be executed by the Governor if the proposal is voted YES on.
    const identifierUtf8 = "TEST-NEW-IDENTIFIER";
    const identifierBytes = web3.utils.utf8ToHex(identifierUtf8);
    const proposedTx = identifierWhitelist.contract.methods.addSupportedIdentifier(identifierBytes).encodeABI();

    console.log("Admin proposal transaction", proposedTx);

    // Confirm that the caller holds the proposer role in the Governor contract.
    const proposerAddress = await governor.getMember("1");
    const caller = (await web3.eth.getAccounts())[0];
    assert.equal(proposerAddress, caller, "Caller does not hold the PROPOSER role in the Governor");

    // Prerequisites:
    // - Governor must hold the OWNER role for the IdentifierWhitelist if it wants to add new identifiers.
    if ((await identifierWhitelist.owner()) !== governor.address) {
      await identifierWhitelist.transferOwnership(governor.address);
      console.log("Transferred ownership of the IdentifierWhitelist to the Governor");
    }

    // Submit the proposal.
    await governor.propose([
      {
        to: identifierWhitelist.address,
        value: 0,
        data: proposedTx
      }
    ]);

    console.log(`
  
      Newly Proposed DVM Identifier: 
  
      - ${identifierUtf8} (UTF8)
      - ${identifierBytes} (HEX)
  
    `);
  } catch (err) {
    console.error(err);
    callback(err);
  }
  callback();
}

module.exports = propose;
