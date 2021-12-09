import Web3 from "web3";
const { toBN } = Web3.utils;

import winston from "winston";

import {
  createEtherscanLinkMarkdown,
  createFormatFunction,
  PublicNetworks,
  runTransaction,
  ExecutedTransaction,
} from "@uma/common";
import { getAbi } from "@uma/contracts-node";
import { InsuredBridgeL1Client, InsuredBridgeL2Client, GasEstimator } from "@uma/financial-templates-lib";

import type { BN, TransactionType } from "@uma/common";

import BridgeAdapterInterface from "./canonical-bridge-adapters/BridgeAdapterInterface";

export class CrossDomainFinalizer {
  executedL1Transactions: Array<ExecutedTransaction> = []; // store all submitted L1 transactions during execution.

  constructor(
    readonly logger: winston.Logger,
    readonly gasEstimator: GasEstimator,
    readonly l1Client: InsuredBridgeL1Client,
    readonly l2Client: InsuredBridgeL2Client,
    readonly bridgeAdapter: BridgeAdapterInterface,
    readonly account: string,
    readonly crossDomainFinalizationThreshold: number = 5
  ) {}
  async checkForBridgeableL2TokensAndBridge() {
    this.logger.debug({ at: "AcrossRelayer#CrossDomainFinalizer", message: "Checking bridgeable L2 tokens" });

    // Fetch all whitelisted tokens on the particular l2 chainId.
    const whitelistedL2Tokens = this.l1Client.getWhitelistedL2TokensForChainId(this.l2Client.chainId.toString());

    // Check if any of the whitelisted l2Tokens are bridgeable. Do this in one parallel call. Returns an array of bool
    // for each l2Token, describing if it can be bridged from L2->L1.
    const canBridge = await Promise.all(
      whitelistedL2Tokens.map((l2Token) => this.l2Client.bridgeDepositBox.methods.canBridge(l2Token).call())
    );

    // For each canBridge result, check if it is true. If so, then we can bridge the token.
    const bridgeableL2Tokens = whitelistedL2Tokens.filter((_, index) => canBridge[index]);

    // Finally, iterate over the bridgeable l2Tokens and bridge them.
    if (bridgeableL2Tokens.length == 0) {
      this.logger.debug({ at: "AcrossRelayer#CrossDomainFinalizer", message: "No bridgeable L2 tokens" });
      return;
    }
    // Track the account nonce and manually increment on each TX. We need to do this because the L2 transactions
    // process quicker than the infura node updates and we need to avoid the nonce collision.
    let nonce = await this.l2Client.l2Web3.eth.getTransactionCount(this.account);
    for (const l2Token of bridgeableL2Tokens) {
      // For each bridgeable L2Token, check the balance in the deposit box. If it is greater than
      // crossDomainFinalizationThreshold, as a percentage, then we can bridge it.

      try {
        const { symbol, decimals, l2PoolBalance } = await this._getL2TokenInfo(l2Token);
        const l1PoolReserves = await this._getL1PoolReserves(l2Token);

        if (l2PoolBalance.gt(toBN(this.crossDomainFinalizationThreshold).mul(l1PoolReserves).div(toBN(100)))) {
          this.logger.debug({
            at: "AcrossRelayer#CrossDomainFinalizer",
            message: "L2 balance > cross domain finalization threshold % of L1 pool reserves, bridging",
            l2Token,
            l2PoolBalance: l2PoolBalance.toString(),
            l1PoolReserves: l1PoolReserves.toString(),
            crossDomainFinalizationThresholdPercent: this.crossDomainFinalizationThreshold,
          });
          await this._bridgeL2Token(l2Token, nonce, symbol, decimals);
          nonce++; // increment the nonce for the next transaction.
        } else {
          this.logger.debug({
            at: "AcrossRelayer#CrossDomainFinalizer",
            message: "L2 balance <= cross domain finalization threshold % of L1 pool reserves, skipping",
            l2Token,
            l2PoolBalance: l2PoolBalance.toString(),
            l1PoolReserves: l1PoolReserves.toString(),
            crossDomainFinalizationThresholdPercent: this.crossDomainFinalizationThreshold,
          });
        }
      } catch (error) {
        this.logger.error({
          at: "AcrossRelayer#CrossDomainFinalizer",
          message: "Something errored sending tokens over the canonical bridge!",
          error,
        });
      }
    }
  }

  async checkForConfirmedL2ToL1RelaysAndFinalize() {
    // Fetch all whitelisted L2 tokens.
    const whitelistedL2Tokens = this.l1Client.getWhitelistedL2TokensForChainId(this.l2Client.chainId.toString());

    // For each whitelisted L2 token, fetch all associated "TokensBridge" transaction hashes on L2. This will return an
    // array of arrays, with each L2 token's transaction hashes being the nested array to each L2Token.
    const l2TokensBridgedTransactions = whitelistedL2Tokens
      .map((l2Token) => this.l2Client.getTokensBridgedTransactionsForL2Token(l2Token))
      .flat(2) // Flatten the array to get a 1D array of all TokenBridged transaction hashes.
      .filter((transaction: string) => transaction); // filter out undefined or null values. this'll happen if there has never been a token bridging action.

    this.logger.debug({
      at: "CrossDomainFinalizer",
      message: `Checking for confirmed L2->L1 canonical bridge actions`,
      whitelistedL2Tokens,
      l2TokensBridgedTransactions,
    });

    // For each transaction hash, check if it has been confirmed and can be relayed. This method will return either a
    // transactionType that can be submitted on L1 or will return null (not confirmed or not ready to relay) and the
    // L2 transaction hash associated with the cross domain action.
    const finalizationTransactions = await Promise.all(
      l2TokensBridgedTransactions.map((hash) => this.bridgeAdapter.constructCrossDomainFinalizationTransaction(hash))
    );

    // Filter out any null valued finalization transactions. This leaves us with an array of objects containing only
    // L2->L1 Finalization transactions that can be executed and the associated L2 tokens bridged tx hash.
    const confirmedFinalizationTransactions = finalizationTransactions.filter((tx) => tx.finalizationTransaction);

    if (confirmedFinalizationTransactions.length == 0) {
      this.logger.debug({ at: "CrossDomainFinalizer", message: `No L2->L1 relays to finalize` });
      return;
    }

    // If there are confirmed finalization transactions, then we can execute them.
    this.logger.debug({
      at: "CrossDomainFinalizer",
      message: `Found L2->L1 relays to finalize`,
      confirmedL2TransactionsToExecute: confirmedFinalizationTransactions.map((tx) => tx.l2TransactionHash),
    });

    for (const l2TokenBridgedTransaction of confirmedFinalizationTransactions) {
      if (l2TokenBridgedTransaction.finalizationTransaction)
        await this.executeConfirmedL2ToL1Relay(
          l2TokenBridgedTransaction.l2TransactionHash,
          l2TokenBridgedTransaction.finalizationTransaction
        );
    }
  }

  getExecutedTransactions(): ExecutedTransaction[] {
    return this.executedL1Transactions;
  }

  resetExecutedTransactions() {
    this.executedL1Transactions = [];
  }

  // Bridged L2 tokens and returns the current account nonce after the transaction.
  private async _bridgeL2Token(l2Token: string, nonce: number, symbol: string, decimals: number) {
    // Note that this tx sending method is NOT using TransactionUtils runTransaction as it is not required on L2.
    // Provide the nonce manually. Web3.js will increment it for us normally but it struggle with doing thins on L2s.
    const receipt = await this.l2Client.bridgeDepositBox.methods
      .bridgeTokens(l2Token, "0") // The second term in this function call is l2Gas, which is currently unused.
      .send({ from: this.account, nonce });

    if (receipt.events) {
      const tokensSent = receipt.events.TokensBridged.returnValues.numberOfTokensBridged;
      this.logger.info({
        at: "AcrossRelayer#CrossDomainFinalizer",
        message: `${symbol} sent over ${PublicNetworks[this.l2Client.chainId]?.name} bridge! 🌁`,
        mrkdwn:
          createFormatFunction(2, 4, false, decimals)(tokensSent) +
          " " +
          symbol +
          " was sent over the canonical " +
          PublicNetworks[this.l2Client.chainId]?.name +
          " bridge. tx: " +
          createEtherscanLinkMarkdown(receipt.transactionHash, this.l2Client.chainId),
      });
    }
  }

  // Executes a confirmed L2->L1 relay transaction over the canonical bridge.
  private async executeConfirmedL2ToL1Relay(l2TransactionHash: string, finalizationTransaction: TransactionType) {
    try {
      // Fetch info about the TokensBridged transaction to populate logs.
      const l2Token = this.l2Client.getL2TokenForTokensBridgedTransactionHash(l2TransactionHash);
      const tokensBridged = this.l2Client.getTokensBridgedForTokenBridgeTransactionHash(l2Token, l2TransactionHash);
      const { symbol, decimals } = await this._getL2TokenInfo(l2Token);

      await this.gasEstimator.update();
      const executionResult = await runTransaction({
        web3: this.l1Client.l1Web3,
        transaction: finalizationTransaction,
        transactionConfig: { ...this.gasEstimator.getCurrentFastPrice(), from: this.account },
        availableAccounts: 1,
        waitForMine: false,
      });
      if (executionResult.receipt) {
        this.logger.info({
          at: "AcrossRelayer#CrossDomainFinalizer",
          message: `${PublicNetworks[this.l2Client.chainId]?.name} canonical relay finalized 🪄`,
          mrkdwn:
            "Canonical L2->L1 transfer over the " +
            PublicNetworks[this.l2Client.chainId]?.name +
            " bridge. A total of " +
            createFormatFunction(2, 4, false, decimals)(tokensBridged) +
            " " +
            symbol +
            " were bridged. L2 TokensBridged TX: " +
            createEtherscanLinkMarkdown(l2TransactionHash, this.l2Client.chainId) +
            ". tx: " +
            createEtherscanLinkMarkdown(executionResult.transactionHash),
        });
        this.executedL1Transactions.push(executionResult);
      } else throw executionResult;
    } catch (error) {
      this.logger.error({
        at: "AcrossRelayer#CrossDomainFinalizer",
        message: "Something errored sending a transaction",
        error,
      });
    }
  }

  // Fetch info about a token on L2.
  private async _getL2TokenInfo(l2Token: string): Promise<{ symbol: string; decimals: number; l2PoolBalance: BN }> {
    const l2TokenInstance = new this.l2Client.l2Web3.eth.Contract(getAbi("ERC20"), l2Token);

    const [symbol, decimals, l2PoolBalance] = await Promise.all([
      l2TokenInstance.methods.symbol().call(),
      l2TokenInstance.methods.decimals().call(),
      l2TokenInstance.methods.balanceOf(this.l2Client.bridgeDepositBox.options.address).call(),
    ]);

    return { symbol, decimals, l2PoolBalance: toBN(l2PoolBalance) };
  }

  // Fetch L1 pool reserves for a given l2Token.
  private async _getL1PoolReserves(l2Token: string): Promise<BN> {
    const bridgePool = this.l1Client.getBridgePoolForL2Token(l2Token, this.l2Client.chainId.toString()).contract;

    const [liquidReserves, utilizedReserves] = await Promise.all([
      bridgePool.methods.liquidReserves().call(),
      bridgePool.methods.utilizedReserves().call(),
    ]);
    return toBN(liquidReserves).add(toBN(utilizedReserves));
  }
}
