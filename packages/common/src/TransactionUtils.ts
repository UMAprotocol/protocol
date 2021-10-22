import util from "util";
import minimist from "minimist";
import ynatm from "@umaprotocol/ynatm";
import type Web3 from "web3";
import type { TransactionReceipt } from "web3-core";
import type { ContractSendMethod, SendOptions } from "web3-eth-contract";

type CallReturnValue = ReturnType<ContractSendMethod["call"]>;
interface AugmentedSendOptions extends SendOptions {
  chainId?: string;
  usingOffSetDSProxyAccount?: boolean;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
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
 * @return Error and type of error (originating from `.call()` or `.send()`) or transaction receipt and return value.
 */
export const runTransaction = async ({
  web3,
  transaction,
  transactionConfig,
  availableAccounts = 1,
}: {
  web3: Web3;
  transaction: ContractSendMethod;
  transactionConfig: AugmentedSendOptions;
  availableAccounts?: number;
}): Promise<{
  receipt: TransactionReceipt;
  returnValue: CallReturnValue;
  transactionConfig: AugmentedSendOptions;
}> => {
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
  // This method does not play nicely in tests. Leave the nonce null to auto fill.
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

    // ynatm doubles gasPrice or maxPriorityFeePerGas every retry depending if the transaction is a legacy or London.
    // Tries every minute(and increases gas price according to DOUBLE method) if tx hasn't mined. Min Gas price starts
    // at caller's transactionConfig.gasPrice or, with transactionConfig.maxPriorityFeePerGas a max gasPrice of x6.
    const gasPriceScalingFunction = ynatm.DOUBLES;
    const retryDelay = 1000;
    if (!transactionConfig.gasPrice && !(transactionConfig.maxFeePerGas && transactionConfig.maxPriorityFeePerGas))
      throw new Error("No gas information provided");
    let receipt;

    // If the config contains maxPriorityFeePerGas then this is a london transaction.
    if (transactionConfig.maxFeePerGas && transactionConfig.maxPriorityFeePerGas) {
      const minPriorityFeePerGas = transactionConfig.maxPriorityFeePerGas || (1e9).toString();
      const maxPriorityFeePerGas = 2 * 3 * parseInt(minPriorityFeePerGas);

      receipt = await ynatm.send({
        sendTransactionFunction: (maxPriorityFeePerGas: number) =>
          transaction.send({ ...transactionConfig, maxPriorityFeePerGas: maxPriorityFeePerGas.toString() } as any),
        minGasPrice: minPriorityFeePerGas,
        maxGasPrice: maxPriorityFeePerGas,
        gasPriceScalingFunction,
        delay: retryDelay,
      });

      // Else, this is a legacy tx.
    } else if (transactionConfig.gasPrice) {
      const minGasPrice = transactionConfig.gasPrice;
      const maxGasPrice = 2 * 3 * parseInt(minGasPrice);

      receipt = await ynatm.send({
        sendTransactionFunction: (gasPrice: number) =>
          transaction.send({ ...transactionConfig, gasPrice: gasPrice.toString() }),
        minGasPrice,
        maxGasPrice,
        gasPriceScalingFunction,
        delay: retryDelay,
      });
    } else {
      throw "Bad transactionConfig! not formatted correctly for pre or post london";
    }

    // Note: cast is due to an incorrect type in the web3 declarations that assumes send returns a contract.
    return { receipt: (receipt as unknown) as TransactionReceipt, returnValue, transactionConfig };
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
export async function findBlockNumberAtTimestamp(
  web3: Web3,
  targetTimestamp: number,
  higherLimitMax = 15,
  lowerLimitMax = 15
): Promise<{ blockNumber: number; error: number }> {
  const higherLimitStamp = targetTimestamp + higherLimitMax;
  const lowerLimitStamp = targetTimestamp - lowerLimitMax;
  // Decreasing average block size will decrease precision and also decrease the amount of requests made in order to
  // find the closest block.
  const averageBlockTime = 13;

  // get current block number
  const currentBlockNumber = await web3.eth.getBlockNumber();
  let block = await web3.eth.getBlock(currentBlockNumber);
  let blockNumber = currentBlockNumber;

  while (block.timestamp > targetTimestamp) {
    const decreaseBlocks = Math.floor((parseInt(block.timestamp.toString()) - targetTimestamp) / averageBlockTime);

    if (decreaseBlocks < 1) break;

    blockNumber -= decreaseBlocks;
    block = await web3.eth.getBlock(blockNumber);
  }

  if (lowerLimitStamp && block.timestamp < lowerLimitStamp) {
    while (block.timestamp < lowerLimitStamp) {
      blockNumber += 1;
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
