#!/usr/bin/env node

const { getContract, web3 } = require("hardhat");

const IdentifierWhitelist = getContract("IdentifierWhitelist");
const Governor = getContract("Governor");
const assert = require("assert");
const argv = require("minimist")(process.argv.slice(), { boolean: ["prod"] });

// Customizable settings:
// - Identifier UTF8 to add to whitelist
const IDENTIFIER_TO_WHITELIST_UTF8 = "CHANGEME";

async function main() {
  /** *******************************
   *
   * WEB3 Account Metadata Checks
   *
   *********************************/
  const [signingAccount] = await web3.eth.getAccounts();
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
  const proposedTx = identifierWhitelist.methods.addSupportedIdentifier(identifierBytes).encodeABI();
  console.log("- Admin proposal transaction", proposedTx);

  // Confirm that the caller holds the proposer role in the Governor contract.
  const proposerAddress = await governor.methods.getMember("1").call();
  assert.strictEqual(proposerAddress, signingAccount, "- Caller does not hold the PROPOSER role in the Governor");

  // - Governor must hold the OWNER role for the IdentifierWhitelist if it wants to add new identifiers.
  if ((await identifierWhitelist.methods.owner().call()) !== governor.options.address) {
    await identifierWhitelist.methods.transferOwnership(governor.options.address).send({ from: proposerAddress });
    console.log("- Transferred ownership of the IdentifierWhitelist to the Governor");
  }
  console.groupEnd();

  /** *******************************
   *
   * Submit the Proposal
   *
   *********************************/
  const proposalTxn = governor.methods.propose([
    { to: identifierWhitelist.options.address, value: 0, data: proposedTx },
  ]);
  const estimatedGas = await proposalTxn.estimateGas({ from: proposerAddress });
  console.log(`Successful simulated execution! Estimated gas: ${estimatedGas}`);

  // For security, force the user to explicitly run this in production mode before sending a mainnet transaction.
  if (argv.prod) {
    await governor.methods
      .propose([{ to: identifierWhitelist.options.address, value: 0, data: proposedTx }])
      .send({ from: proposerAddress })
      .on("transactionHash", function (hash) {
        console.log(`- Pending transaction hash: ${hash}`);
      })
      .on("receipt", function (receipt) {
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
}

main().then(
  () => {
    process.exit(0);
  },
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
