// Send a transaction to the caller's account with a very high gas price in order to overwrite a pending transaction
// that has not been mined yet. Optional flags include --nonce and --gasPrice which can customize the behavior
// of this script. This may not always work but we can increase our chances by bumping the gas price higher.

// Example execution command (from packages/core):
// - yarn truffle exec ./packages/core/scripts/mainnet/ProposeAdmin.js --network mainnet_gckms --keys deployer --gasPrice 200 --nonce 303

const argv = require("minimist")(process.argv.slice(), { string: ["gasPrice", "nonce"] });

async function cancelPendingTransaction(callback) {
  try {
    /** *******************************
     *
     * WEB3 Account Metadata Checks
     *
     *********************************/
    const signingAccount = (await web3.eth.getAccounts())[0];
    console.group(`Signing account: ${signingAccount}`);
    // By default, try to cancel the latest nonce.
    const transactionCount = await web3.eth.getTransactionCount(signingAccount);
    console.log(`- Next nonce to be used: ${transactionCount}`);
    const nonce = argv.nonce ? argv.nonce : transactionCount;

    if (!argv.gasPrice) {
      throw new Error("Please specify a --gasPrice (denominated in gwei), for example: --gasPrice 150");
    }
    const gasPrice = web3.utils.toWei(argv.gasPrice, "gwei");
    const txnConfig = { from: signingAccount, to: signingAccount, value: 0, gasPrice: gasPrice, nonce: nonce };
    console.log("- Transaction Config: ", txnConfig);

    /** *******************************
     *
     * Sending the transaction
     *
     *********************************/
    await web3.eth
      .sendTransaction(txnConfig)
      .on("transactionHash", function (hash) {
        console.log(`- Pending transaction hash: ${hash}`);
      })
      .on("receipt", function (receipt) {
        console.log("- Successfully sent:", receipt);
      })
      .on("error", console.error);

    console.groupEnd();
  } catch (err) {
    callback(err);
  }
  callback();
}

module.exports = cancelPendingTransaction;
