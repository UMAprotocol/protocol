const util = require("util");
const argv = require("minimist")(process.argv.slice(), {});
const ynatm = require("@umaprotocol/ynatm");

/**
 * Simulate transaction via .call() and then .send() and return receipt. If an error is thrown, return the error and add
 * a flag denoting whether it was sent on the .call() or the .send(). Enables multiple EOAs to be used when sending the
 * transaction, cycling if a lower EOA index has a pending transaction.
 * @notice Uses the ynatm package to retry the transaction with increasing gas price.
 * @param {*Object} web3.js object for making queries and accessing Ethereum related methods.
 * @param {*Object} transaction Transaction to call `.call()` and subsequently `.send()` on from `senderAccount`.
 * @param {*Object} config transaction config, e.g. { gasPrice, from }, passed to web3 transaction.
 * @return Error and type of error (originating from `.call()` or `.send()`) or transaction receipt and return value.
 */
const runTransaction = async ({ web3, transaction, transactionConfig, availableAccounts = 1 }) => {
  // Add chainId in case RPC enforces transactions to be replay-protected, (i.e. enforced in geth v1.10,
  // https://blog.ethereum.org/2021/03/03/geth-v1-10-0/).
  transactionConfig.chainId = web3.utils.toHex(await web3.eth.getChainId());

  // Multiplier applied to Truffle's estimated gas limit for a transaction to send.
  const GAS_LIMIT_BUFFER = 1.25;

  // If set to access multiple accounts, then check which is the first in the array of accounts that does not have a
  // pending transaction. Note if all accounts have pending transactions then the account provided in the original
  // config.from (accounts[0]) will be used.
  if (availableAccounts > 1) {
    const availableAccountsArray = (await web3.eth.getAccounts()).slice(0, availableAccounts);
    for (const account of availableAccountsArray) {
      if (!(await accountHasPendingTransactions(web3, account))) {
        transactionConfig.from = account; // set the account to execute the transaction to the available account.
        transactionConfig.usingOffSetDSProxyAccount = true; // add a bit more details to the logs produced.
        break;
      }
    }
  }

  // Compute the selected account nonce. If the account has a pending transaction then use the subsequent index after the
  // pending transactions to ensure this new transaction does not collide with any existing transactions in the mempool.
  if (await accountHasPendingTransactions(web3, transactionConfig.from))
    transactionConfig.nonce = await getPendingTransactionCount(web3, transactionConfig.from);
  // Else, there is no pending transaction and we use the current account transaction count as the nonce.
  // This method does not play niceley in tests. Leave the nounce null to auto fill.
  else if (argv.network != "test") transactionConfig.nonce = await web3.eth.getTransactionCount(transactionConfig.from);

  // Next, simulate transaction and also extract return value if its a state-modifying transaction. If the function is state
  // modifying, then successfully sending it will return the transaction receipt, not the return value, so we grab it here.
  let returnValue, estimatedGas;
  try {
    [returnValue, estimatedGas] = await Promise.all([
      transaction.call({ from: transactionConfig.from }),
      transaction.estimateGas({ from: transactionConfig.from }),
    ]);
  } catch (error) {
    error.type = "call";
    throw error;
  }

  // .call() succeeded, now broadcast transaction.
  try {
    transactionConfig = { ...transactionConfig, gas: Math.floor(estimatedGas * GAS_LIMIT_BUFFER) };

    // ynatm doubles gasPrice every retry. Tries every minute (and increases gas price according to DOUBLE method) if tx
    // hasn't mined. Min Gas price starts at caller's transactionConfig.gasPrice, with a max gasPrice of x6.
    const gasPriceScalingFunction = ynatm.DOUBLES;
    const retryDelay = 60000;
    const minGasPrice = transactionConfig.gasPrice;
    const maxGasPrice = 2 * 3 * minGasPrice;

    const receipt = await ynatm.send({
      sendTransactionFunction: (gasPrice) => transaction.send({ ...transactionConfig, gasPrice }),
      minGasPrice,
      maxGasPrice,
      gasPriceScalingFunction,
      delay: retryDelay,
    });

    return { receipt, returnValue, transactionConfig };
  } catch (error) {
    error.type = "send";
    throw error;
  }
};

/**
 * Checks if an account has a pending transaction.
 * @param {*Object} web3.js object for making queries and accessing Ethereum related methods.
 * @param {*string} account account to check.
 * @return Bool true if the account has pending transaction and false if no pending transaction.
 */
const accountHasPendingTransactions = async (web3, account) => {
  const [currentMindedTransactions, currentTransactionsIncludingPending] = await Promise.all([
    web3.eth.getTransactionCount(account, "latest"),
    getPendingTransactionCount(web3, account),
  ]);
  return currentTransactionsIncludingPending > currentMindedTransactions;
};

/**
 * Returns the number of pending transaction an account has. This method uses `provider.send` syntax. This undocumented
 * web3 method lets you call direct jsonrpc methods on the provider. This method differs from the web3.js getTransactionCount
 * by including mempool transactions. see https://infura.io/docs/ethereum/json-rpc/eth-getTransactionCount
 * @param {*Object} web3.js object for making queries and accessing Ethereum related methods.
 * @param {*string} account account to check.
 * @returns number representing the number of transactions, including pending.
 */
const getPendingTransactionCount = async (web3, account) => {
  const sendRpc = util.promisify(web3.currentProvider.send).bind(web3.currentProvider);

  const rpcResponse = await sendRpc({
    jsonrpc: "2.0",
    method: "eth_getTransactionCount",
    params: [account, "pending"],
    id: Math.round(Math.random() * 100000),
  });
  return web3.utils.toDecimal(rpcResponse.result);
};

/**
 * Blocking code until a specific block number is mined. Will re-fetch the current block number every 500ms. Useful when
 * using methods called on contracts directly after state changes. Max blocking time should be ~ 15 seconds.
 * @param {Object} web3 Provider from Truffle/node to connect to Ethereum network.
 * @param {number} blockerBlockNumber block execution until this block number is mined.
 */
const blockUntilBlockMined = async (web3, blockerBlockNumber, delay = 500) => {
  if (argv._.indexOf("test") !== -1) return;
  for (;;) {
    const currentBlockNumber = await web3.eth.getBlockNumber();
    if (currentBlockNumber >= blockerBlockNumber) break;
    await new Promise((r) => setTimeout(r, delay));
  }
};

module.exports = { runTransaction, blockUntilBlockMined, accountHasPendingTransactions };
