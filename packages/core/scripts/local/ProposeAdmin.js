// This script proposes a contrived admin proposal to the DVM. Specifically, its a proposal to whitelist
// a new price identifier.

// @dev: This script will FAIL if the caller (i.e. web3.accounts[0]) does not hold the PROPOSER role in the Governor contract
// Dec 1st: The current Proposer is the same account used to make proposals in the `identifier-umip` scripts, and can be
// accessed using `--network mainnet_gckms --keys deployer`
// @dev: This script will have the side effect of making the Governor contract the owner of the IdentifierWhitelist.

// Example execution command (from packages/core):
// - yarn truffle exec ./scripts/local/ProposeAdmin.js --network mainnet_gckms --keys deployer --gasPrice 55 --nonce 305
// Note: the above command will simulate sending the mainnet proposal transaction, run it again with the "--prod" flag
// to actually send the transaction on mainnet.

const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const Governor = artifacts.require("Governor");
const assert = require("assert");
const argv = require("minimist")(process.argv.slice(), {
  string: ["nonce", "gasPrice", "prod"]
});

// Customizable settings:
// - Identifier UTF8 to add to whitelist
const IDENTIFIER_TO_WHITELIST_UTF8 = "CHANGE-ME";

async function propose(callback) {
  try {
    /** *******************************
     *
     * WEB3 Account Metadata Checks
     *
     *********************************/
    const signingAccount = (await web3.eth.getAccounts())[0];
    console.group(`Proposer account: ${signingAccount}`);
    const nextNonce = Number(await web3.eth.getTransactionCount(signingAccount));
    console.log(`- Default next nonce to be used: ${nextNonce}`);

    // Force the user to specify nonce and gas price so that they are less likely to send duplicate proposals,
    // which would result in unneccessary duplicated Admin votes.
    if (!argv.nonce || !argv.gasPrice) {
      throw new Error(`- Specify --gasPrice and --nonce, e.g. --gasPrice 50 --nonce ${nextNonce}`);
    }
    const gasPrice = web3.utils.toWei(argv.gasPrice, "gwei");
    const nonce = argv.nonce;
    console.log(`- Custom gasPrice (wei): ${gasPrice}`);
    console.log(`- Custom nonce: ${nonce}`);
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
    const txnConfig = {
      from: proposerAddress,
      gasPrice,
      nonce
    };
    const proposalTxn = governor.contract.methods.propose([
      {
        to: identifierWhitelist.address,
        value: 0,
        data: proposedTx
      }
    ]);
    const estimatedGas = await proposalTxn.estimateGas(txnConfig);
    console.log(`Successful simulated execution! Estimated gas: ${estimatedGas}`);
    console.log("Run this script again with the --prod flag set to send the transaction on mainnet.");

    // For security, force the user to explicitly run this in production mode before sending a mainnet transaction.
    if (argv.prod) {
      await governor.propose(
        [
          {
            to: identifierWhitelist.address,
            value: 0,
            data: proposedTx
          }
        ],
        {
          gasPrice,
          nonce
        }
      );

      console.log(`
    
        Newly Proposed DVM Identifier: 
    
        - ${IDENTIFIER_TO_WHITELIST_UTF8} (UTF8)
        - ${identifierBytes} (HEX)
    
      `);
    }
  } catch (err) {
    callback(err);
  }
  callback();
}

module.exports = propose;
