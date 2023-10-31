import util from "util";
import minimist from "minimist";
import winston from "winston";

import type Web3 from "web3";
import type { TransactionReceipt, PromiEvent } from "web3-core";
import type { ContractSendMethod, SendOptions } from "web3-eth-contract";

type CallReturnValue = ReturnType<ContractSendMethod["call"]>;
export interface AugmentedSendOptions {
  from: string;
  gas?: number;
  value?: number | string;
  nonce?: number;
  chainId?: string;
  type?: string;
  usingOffSetDSProxyAccount?: boolean;
  gasPrice?: number | string;
  maxFeePerGas?: number | string;
  maxPriorityFeePerGas?: number | string;
}

interface AugmentedWeb3 extends Web3 {
  nonces: { [address: string]: number };
}

export interface ExecutedTransaction {
  receipt: TransactionReceipt | PromiEvent<TransactionReceipt>;
  transactionHash: string;
  returnValue: CallReturnValue;
  transactionConfig: AugmentedSendOptions;
}

const argv = minimist(process.argv.slice(), {});

/**
 * Simulate transaction via .call() and then .send() and return receipt. If an error is thrown, return the error and add
 * a flag denoting whether it was sent on the .call() or the .send(). Enables multiple EOAs to be used when sending the
 * transaction, cycling if a lower EOA index has a pending transaction.
 * @notice Uses the ynatm package to retry the transaction with increasing gas price.
 * @param {*Object} web3.js object for making queries and accessing Ethereum related methods.
 * @param {*Object} transaction Transaction to call `.call()` and subsequently `.send()` on from `senderAccount`.
 * @param {*Object} transactionConfig config, e.g. { maxFeePerGas, maxPriorityFeePerGas, from } or { gasPrice, from}
 *     depending if this is a london or pre-london transaction, passed to transaction.
 * @param availableAccounts {number} defines how many EOAs the transaction runner has access too. If the 0th account
 * has a pending tx then the runner will automatically send the transaction from the next EOA.
 * @param waitForMine {Boolean} informs if the transaction runner should wait until the tx is mined or return early once
 * it has a transaction hash. Useful when sending many transactions in quick succession.
 * @return Error and type of error (originating from `.call()` or `.send()`) or transaction receipt, return value and
 * transaction config. Note that the transaction receipt will be a promise if waitForMine is false.
 */
export const runTransaction = async ({
  web3: _web3,
  transaction,
  transactionConfig,
  availableAccounts = 1,
  waitForMine = true,
}: {
  web3: Web3;
  transaction: ContractSendMethod;
  transactionConfig: AugmentedSendOptions;
  availableAccounts?: number;
  waitForMine?: boolean;
}): Promise<ExecutedTransaction> => {
  // Use a cast version of web3 to enable callers to not have to define the `nonces` mapping in the web3 object.
  const web3 = _web3 as AugmentedWeb3;
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

  // Simulate transaction and also extract return value if its a state-modifying transaction. If the function is state
  // modifying, then successfully sending it will return the transaction receipt, not the return value, so we grab it here.
  let returnValue, estimatedGas;
  try {
    [returnValue, estimatedGas] = await Promise.all([
      transaction.call({ from: transactionConfig.from }),
      transaction.estimateGas({ from: transactionConfig.from }),
    ]);
  } catch (error) {
    const castedError = error as Error & { type?: string };
    castedError.type = "call";
    throw castedError;
  }

  // .call() succeeded, compute selected account nonce. If the account has a pending transaction then use the subsequent
  // index after the pending transactions to ensure this new transaction does not collide with any existing transactions
  // in the mempool.
  if (await accountHasPendingTransactions(web3, transactionConfig.from))
    transactionConfig.nonce = await getPendingTransactionCount(web3, transactionConfig.from);
  // Else, there is no pending transaction and we use the current account transaction count as the nonce.
  // This method does not play nicely in tests. Leave the nonce null to auto fill.
  else if (argv.network != "test" && !argv._.some((e) => /test/g.test(e)))
    transactionConfig.nonce = await web3.eth.getTransactionCount(transactionConfig.from);
  // Store the transaction nonce in the web3 object so that it can be used in the future. This enables us to fire a
  // bunch of transactions off without needing to wait for them to be included in the mempool by manually incrementing.
  if (argv.network != "test" && !argv._.some((e) => /test/g.test(e))) {
    if (web3.nonces?.[transactionConfig.from]) transactionConfig.nonce = ++web3.nonces[transactionConfig.from];
    else if (transactionConfig.nonce)
      web3.nonces = {
        ...web3.nonces,
        [transactionConfig.from]: transactionConfig.nonce,
      };
  }

  // Now broadcast the transaction.
  try {
    transactionConfig = { ...transactionConfig, gas: Math.floor(estimatedGas * GAS_LIMIT_BUFFER) };

    // Pre-London transactions require `gasPrice`, London transactions require `maxFeePerGas` and `maxPriorityFeePerGas`

    let receipt: TransactionReceipt | PromiEvent<TransactionReceipt>;
    let transactionHash: string;

    // If the config contains maxPriorityFeePerGas then this is a London transaction. In this case, simply use the
    // provided config settings but double the maxFeePerGas to ensure the transaction is included, even if the base fee
    // spikes up. The difference between the realized base fee and maxFeePerGas is refunded in a London transaction.
    if (transactionConfig.maxFeePerGas && transactionConfig.maxPriorityFeePerGas) {
      // If waitForMine is set (default) then code blocks until the transaction is mined and a receipt is returned.
      if (waitForMine) {
        receipt = ((await transaction.send({
          ...transactionConfig,
          maxFeePerGas: parseInt(transactionConfig.maxFeePerGas.toString()) * 2,
          type: "0x2",
        } as SendOptions)) as unknown) as TransactionReceipt;
        transactionHash = receipt.transactionHash;
      }
      // Else, waitForMine is false and we return the transaction hash immediately as soon as it is included in the
      // mempool. Receipt is a promise of the pending transaction that can be awaited later to ensure block inclusion.
      else {
        receipt = (transaction.send({
          ...transactionConfig,
          maxFeePerGas: parseInt(transactionConfig.maxFeePerGas.toString()) * 2,
          type: "0x2",
        } as SendOptions) as unknown) as PromiEvent<TransactionReceipt>;
        transactionHash = await new Promise((resolve, reject) => {
          const _receipt = receipt as PromiEvent<TransactionReceipt>;
          _receipt.on("transactionHash", (transactionHash) => resolve(transactionHash));
          _receipt.on("error", (error) => reject(error));
        });
      }

      // Else this is a legacy tx.
    } else if (transactionConfig.gasPrice) {
      receipt = ((await transaction.send({
        ...transactionConfig,
        gasPrice: transactionConfig.gasPrice.toString(),
      })) as unknown) as TransactionReceipt;
      transactionHash = receipt.transactionHash;
    } else throw new Error("No gas information provided");

    return { receipt, transactionHash, returnValue, transactionConfig };
  } catch (error) {
    const castedError = error as Error & { type?: string };
    castedError.type = "send";
    throw castedError;
  }
};

/**
 * Checks if an account has a pending transaction.
 * @param {*Object} web3.js object for making queries and accessing Ethereum related methods.
 * @param {*string} account account to check.
 * @return Bool true if the account has pending transaction and false if no pending transaction.
 */
export const accountHasPendingTransactions = async (web3: Web3, account: string): Promise<boolean> => {
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
export const getPendingTransactionCount = async (web3: Web3, account: string): Promise<number> => {
  if (!web3.currentProvider || typeof web3.currentProvider === "string" || !web3.currentProvider.send)
    throw new Error("A valid provider with send method not initialized");
  const sendRpc = util.promisify(web3.currentProvider.send).bind(web3.currentProvider);

  const rpcResponse = await sendRpc({
    jsonrpc: "2.0",
    method: "eth_getTransactionCount",
    params: [account, "pending"],
    id: Math.round(Math.random() * 100000),
  });
  if (!rpcResponse || !rpcResponse.result) throw new Error("Bad RPC response");
  return web3.utils.toDecimal(rpcResponse.result);
};

/**
 * Blocking code until a specific block number is mined. Will re-fetch the current block number every 500ms. Useful when
 * using methods called on contracts directly after state changes. Max blocking time should be ~ 15 seconds.
 * @param {Object} web3 Provider from Truffle/node to connect to Ethereum network.
 * @param {number} blockerBlockNumber block execution until this block number is mined.
 */
export const blockUntilBlockMined = async (web3: Web3, blockerBlockNumber: number, delay = 500): Promise<void> => {
  // If called from tests, exit early.
  if (argv._.indexOf("test") !== -1 || argv._.filter((arg) => arg.includes("mocha")).length > 0) return;
  for (;;) {
    const currentBlockNumber = await web3.eth.getBlockNumber();
    if (currentBlockNumber >= blockerBlockNumber) break;
    await new Promise((r) => setTimeout(r, delay));
  }
};

/**
 * @notice Finds block closest to target timestamp. User can configure search based on error tolerance.
 * @param web3 Web3 network to search blocks on.
 * @param targetTimestamp Timestamp that we are finding a block for.
 * @param higherLimitMax Returned block must have timestamp less than targetTimestamp + higherLimitMax. Increasing this
 * increases error and reduces time to compute.
 * @param lowerLimitMax Returned block must have timestamp more than targetTimestamp - lowerLimitMax. Increasing this
 * increases error and reduces time to compute.
 * @param blockDelta Amount of blocks to hop when binary searching for block. Increasing this increases error
 * but significantly reduces time to compute.
 * @param averageBlockTime Decreasing average block size will decrease precision and also decrease the amount of
 * requests made in order to find the closest block. Increasing this reduces time to compute but increases requests.
 * @returns {number, number} Block height and difference between block timestamp and target timestamp
 */
export async function findBlockNumberAtTimestamp(
  web3: Web3,
  targetTimestamp: number,
  higherLimitMax = 15,
  lowerLimitMax = 15,
  blockDelta = 1,
  averageBlockTime = 13
): Promise<{ blockNumber: number; error: number }> {
  const higherLimitStamp = targetTimestamp + higherLimitMax;
  const lowerLimitStamp = targetTimestamp - lowerLimitMax;

  // get current block number
  const currentBlockNumber = await web3.eth.getBlockNumber();
  let block = await web3.eth.getBlock(currentBlockNumber);
  let blockNumber = currentBlockNumber;

  // if current block timestamp > target timestamp, set block to approximate height using `averageBlockTime`, and
  // repeat until we find a block below the target time. This loop should usually only run once, unless the
  // `averageBlockTime` is set too high.
  while (block.timestamp > targetTimestamp) {
    const decreaseBlocks = Math.floor((parseInt(block.timestamp.toString()) - targetTimestamp) / averageBlockTime);

    if (decreaseBlocks < 1) break;

    blockNumber -= decreaseBlocks;
    block = await web3.eth.getBlock(blockNumber);
  }

  if (lowerLimitStamp && block.timestamp < lowerLimitStamp) {
    while (block.timestamp < lowerLimitStamp) {
      blockNumber += blockDelta;
      block = await web3.eth.getBlock(blockNumber);
    }
  }

  // If we ended with a block higher than we can walk block by block to find the correct one.
  if (higherLimitStamp) {
    if (block.timestamp >= higherLimitStamp) {
      while (block.timestamp >= higherLimitStamp) {
        blockNumber -= 1;
        block = await web3.eth.getBlock(blockNumber);
      }
    }

    // If we ended up with a block lower than the upper limit walk block by block to make sure it's the correct one.
    if (block.timestamp < higherLimitStamp) {
      while (block.timestamp < higherLimitStamp) {
        blockNumber += 1;
        if (blockNumber > currentBlockNumber) break;
        const tempBlock = await web3.eth.getBlock(blockNumber);
        // Can't be equal or higher than upper limit as we want to find the last block before that limit.
        if (tempBlock.timestamp >= higherLimitStamp) break;

        block = tempBlock;
      }
    }
  }
  return { blockNumber: block.number, error: Math.abs(targetTimestamp - parseInt(block.timestamp.toString())) };
}

/**
 * @notice Consumes an array of transactions with embedded promises produced by iteratively calling runTransaction.
 * Waits on all transactions to settle within the batch (included in a block). If any transaction contains an error then
 * produce a log to that effect. This method is intended to be called at the end of a bot run cycle to ensure that all
 * transactions that were submitted were indeed included without error. Note that runTransaction will not submit a
 * transaction if the function can detect it will revert (i.e using the .call syntax). Therefore this function will only
 * catch reverts that could not be seen at submission time.
 */
export async function processTransactionPromiseBatch(transactions: Array<ExecutedTransaction>, logger: winston.Logger) {
  if (transactions.length == 0) return;
  logger.debug({
    at: "TransactionUtils",
    message: "Waiting on transaction batch",
    transactions: transactions.map((transaction) => transaction.transactionHash),
  });
  const transactionResults = await Promise.allSettled(transactions.map((tx: ExecutedTransaction) => tx.receipt));
  const revertedTransactions = transactionResults.filter((result) => result.status === "rejected");
  if (revertedTransactions.length == 0)
    logger.debug({ at: "TransactionUtils", message: "Transaction batch processed without error" });
  else
    logger.error({
      at: "TransactionUtils",
      message: "Transaction batch processed with error",
      errors: revertedTransactions.map((transaction: any) => transaction.reason),
    });
}
