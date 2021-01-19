// This script proposes a contrived admin proposal to the DVM. Specifically, its a proposal to whitelist
// a new price identifier.

// @dev: This script will FAIL if the caller (i.e. web3.accounts[0]) does not hold the PROPOSER role in the Governor contract
// Dec 1st: The current Proposer is the same account used to make proposals in the `identifier-umip` scripts, and can be
// accessed using `--network mainnet_gckms --keys deployer`
// @dev: This script will have the side effect of making the Governor contract the owner of the IdentifierWhitelist.

// Example execution command (from packages/core):
// - yarn truffle exec ./packages/core/scripts/mainnet/ProposeAdmin.js --network mainnet_gckms --keys deployer
// Note: the above command will simulate sending the mainnet proposal transaction, run it again with the "--prod" flag
// to actually send the transaction on mainnet.

const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const Governor = artifacts.require("Governor");
const assert = require("assert");
const argv = require("minimist")(process.argv.slice(), {
  boolean: ["prod"]
});

// Customizable settings:
// - Identifier UTF8 to add to whitelist
const IDENTIFIER_TO_WHITELIST_UTF8 = "CHANGEME";

async function propose(callback) {
  try {
    /** *******************************
     *
     * WEB3 Account Metadata Checks
     *
     *********************************/
    const signingAccount = (await web3.eth.getAccounts())[0];
    console.group(`Proposer account: ${signingAccount}`);
    console.groupEnd();

    /** *******************************
     *
     * Governor Proposal Checks
     *
     *********************************/
    console.group(`Proposing to whitelist new identifier: ${IDENTIFIER_TO_WHITELIST_UTF8}`);
    const identifierWhitelist = await IdentifierWhitelist.deployed();
    const governor = await Governor.deployed();

    // The `proposedTx` will be executed by the Governor if the proposal is voted YES on.
    const identifierBytes = web3.utils.utf8ToHex(IDENTIFIER_TO_WHITELIST_UTF8);
    console.log(`- Hex identifier for ${IDENTIFIER_TO_WHITELIST_UTF8}: ${identifierBytes}`);
    const proposedTx = identifierWhitelist.contract.methods.addSupportedIdentifier(identifierBytes).encodeABI();
    console.log("- Admin proposal transaction", proposedTx);

    // Confirm that the caller holds the proposer role in the Governor contract.
    const proposerAddress = await governor.getMember("1");
    assert.strictEqual(proposerAddress, signingAccount, "- Caller does not hold the PROPOSER role in the Governor");

    // - Governor must hold the OWNER role for the IdentifierWhitelist if it wants to add new identifiers.
    if ((await identifierWhitelist.owner()) !== governor.address) {
      await identifierWhitelist.transferOwnership(governor.address);
      console.log("- Transferred ownership of the IdentifierWhitelist to the Governor");
    }
    console.groupEnd();

    /** *******************************
     *
     * Submit the Proposal
     *
     *********************************/
    const proposalTxn = governor.contract.methods.propose([
      {
        to: identifierWhitelist.address,
        value: 0,
        data: proposedTx
      }
    ]);
    const estimatedGas = await proposalTxn.estimateGas({ from: proposerAddress });
    console.log(`Successful simulated execution! Estimated gas: ${estimatedGas}`);

    // For security, force the user to explicitly run this in production mode before sending a mainnet transaction.
    if (argv.prod) {
      await governor
        .propose([
          {
            to: identifierWhitelist.address,
            value: 0,
            data: proposedTx
          }
        ])
        .on("transactionHash", function(hash) {
          console.log(`- Pending transaction hash: ${hash}`);
        })
        .on("receipt", function(receipt) {
          console.log("- Successfully sent:", receipt);
        })
        .on("error", console.error);

      console.log(`
    
        Newly Proposed DVM Identifier: 
    
        - ${IDENTIFIER_TO_WHITELIST_UTF8} (UTF8)
        - ${identifierBytes} (HEX)
    
      `);
    } else {
      console.log(
        "To execute this transaction on Mainnet, run this script with the --prod flag. Be sure that the --gasPrice is set appropriately and that the --nonce would not send out a duplicate admin proposal."
      );
    }
  } catch (err) {
    callback(err);
  }
  callback();
}

module.exports = propose;
