import winston from "winston";
import Web3 from "web3";

import { runTransaction, createEtherscanLinkMarkdown } from "@uma/common";
import { MultiCallerWeb3 } from "@uma/contracts-node";
import { GasEstimator } from "@uma/financial-templates-lib";
import { isErrorOutput } from "./helpers";

import type { TransactionType, ExecutedTransaction } from "@uma/common";
import type { Contract } from "web3-eth-contract";
import type { TransactionReceipt } from "web3-core";

import lodash from "lodash";

interface BaseCall<T extends TransactionType> {
  transaction: T;
  message?: string;
  mrkdwn?: string;
  level?: string;
}

type Call = BaseCall<TransactionType>;
type ExtendedTransasction = TransactionType & { _parent: Contract };
type ExtendedCall = BaseCall<ExtendedTransasction>;

async function allSettledOrError<T>(promises: T[], errorPrefix: string): Promise<Awaited<T>[]> {
  // Allow all transactions to finish before propagating any errors.
  const results = await Promise.allSettled(promises);
  const errors = results.filter(isErrorOutput).map((errorResult) => errorResult.reason);

  // Throw if there are any errors.
  if (errors.length > 0) throw new Error(`${errorPrefix}:\n${errors.join("\n")}`);

  // Cast results to the fulfilled result because we know that there were no errors due to the above check.
  return (results as PromiseFulfilledResult<Awaited<T>>[]).map((element) => element.value);
}

export class MulticallBundler {
  public calls: ExtendedCall[] = [];
  public sentTransactions: ExecutedTransaction[] = [];

  /**
   * @notice Constructs new MulticallBundler instance.
   * @param {Object} logger Module used to send logs.
   * @param {Object} gasEstimator used to estimate gas prices for the receiving chainId.
   * @param {Object} web3 web3 instance containing permissions to send with the provided account.
   * @param {string} account Unlocked web3 account to send transactions.
   */
  constructor(
    readonly logger: winston.Logger,
    readonly gasEstimator: GasEstimator,
    readonly web3: Web3,
    readonly account: string
  ) {}

  public addTransactions(...calls: Call[]): void {
    // Cast just allows us to access nonpublic fields on the transaction.
    const castedCalls = calls as ExtendedCall[];
    this.calls.push(...castedCalls);
  }

  public async send(): Promise<void> {
    const callGroups = lodash.groupBy(this.calls, (call) =>
      this.web3.utils.toChecksumAddress(call.transaction._parent.options.address)
    );

    await allSettledOrError(
      Object.values(callGroups).map(async (calls) => {
        if (calls.length === 1) {
          return await this.sendTransaction(calls[0]);
        } else {
          return await this.batchTransactions(calls);
        }
      }),
      "Error sending batches"
    ).catch((error) => {
      this.logger.error({
        at: "MulticallBundler#send",
        message: "One or more errors sending transaction batches",
        error,
      });
    });

    // After sending, set the calls to an empty array (even if some produced errors).
    this.calls = [];
  }

  public async waitForMine(): Promise<TransactionReceipt[]> {
    try {
      return await allSettledOrError(
        this.sentTransactions.map((transaction) => transaction.receipt),
        "MulticallBundler#waitForMine: some transactions failed to mine"
      );
    } finally {
      // This always gets executed after the return/error.
      this.sentTransactions = [];
    }
  }

  private async sendTransaction(call: ExtendedCall) {
    await this.gasEstimator.update();

    // Run the transaction provided. Note that waitForMine is set to false. This means the function will return as
    // soon as the transaction has been included in the mem pool, but is not yet mined. This is important as we want
    // to be able to fire off as many transactions as quickly as posable. Note that as soon as the transaction is
    // in the mem pool we will produces a transaction hash for logging.
    const executionResult = await runTransaction({
      web3: this.web3,
      transaction: call.transaction,
      transactionConfig: { ...this.gasEstimator.getCurrentFastPrice(), from: this.account },
      availableAccounts: 1,
      waitForMine: false,
    });

    if (!executionResult.receipt) throw new Error("MulticallBundler#sendTransaction: No receipt returned");

    const receiptMarkdown = `tx ${createEtherscanLinkMarkdown(executionResult.transactionHash)}`;
    this.logger.log({
      at: "MulticallBundler#sendTransaction",
      message: call.message || "No message",
      mrkdwn: call.mrkdwn ? `${call.mrkdwn} ${receiptMarkdown}` : receiptMarkdown,
      level: call.level || "info",
    });

    // Just append the execution result. No need to return.
    // Note: appending this way ensures _every_ successful transaction ends up in this array.
    this.sentTransactions.push(executionResult);
  }

  private async batchTransactions(calls: ExtendedCall[]) {
    const multicaller: MultiCallerWeb3 = (calls[0].transaction._parent as unknown) as MultiCallerWeb3;

    let markdownBlock = "*Transactions sent in batch:*\n";
    calls.forEach(({ message, mrkdwn }) => {
      markdownBlock += `  • ${message || "No message"}:\n`;
      markdownBlock += `      ◦ ${mrkdwn || "No markdown"}\n`;
    });

    try {
      // First try as a batch.
      const executionResult = await this.sendTransaction({
        transaction: (multicaller.methods.multicall(
          calls.map(({ transaction }) => transaction.encodeABI())
        ) as unknown) as ExtendedTransasction,
        message: "Multicall batch sent!🧙",
        mrkdwn: markdownBlock,
        level: await this.getMaxLevel(calls),
      });

      // Return the successful result as a single element array.
      return [executionResult];
    } catch (error) {
      // If the batch failed, try sending the transactions individually.
      this.logger.info({
        at: "MulticallBundler#batchTransactions",
        message: "Sending batched transactions individually😷",
        error,
      });

      // Allow all transactions to finish before propagating any errors.
      await allSettledOrError(
        calls.map((call) => this.sendTransaction(call)),
        "Errors sending transactions individually"
      );
    }
  }

  private getMaxLevel(calls: ExtendedCall[]) {
    if (!calls.every((call) => call.level === undefined)) return "info"; // default if no log level is provided.
    if (calls.some((call) => call.level === "error")) return "error";
    if (calls.some((call) => call.level === "warn")) return "warn";
    if (calls.some((call) => call.level === "info")) return "info";
    if (calls.some((call) => call.level === "debug")) return "debug";
    return "info"; // Default to info if no others are found.
  }
}
