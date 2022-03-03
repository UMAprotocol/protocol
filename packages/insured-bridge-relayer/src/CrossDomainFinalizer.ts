import Web3 from "web3";
const { toBN, toWei } = Web3.utils;
const toBNWei = (number: string | number) => toBN(toWei(number.toString()).toString());

import minimist from "minimist";
const argv = minimist(process.argv.slice(), {});

import winston from "winston";

import { across } from "@uma/sdk";
import {
  createEtherscanLinkMarkdown,
  createFormatFunction,
  PublicNetworks,
  runTransaction,
  ExecutedTransaction,
} from "@uma/common";
import { getAbi } from "@uma/contracts-node";
import { InsuredBridgeL1Client, InsuredBridgeL2Client, GasEstimator } from "@uma/financial-templates-lib";

import BridgeAdapterInterface from "./canonical-bridge-adapters/BridgeAdapterInterface";

import type { BN, TransactionType } from "@uma/common";
export interface TokensBridged {
  bridgedTokensTxHash: string;
  numberOfTokens: string;
}

export class CrossDomainFinalizer {
  private executedL1Transactions: Array<ExecutedTransaction> = []; // store all submitted L1 transactions during execution.

  private tokensBridgedTransactions: { [key: string]: TokensBridged[] } = {}; // L2Token=>BridgeTransactionHash[]

  constructor(
    readonly logger: winston.Logger,
    readonly gasEstimator: GasEstimator,
    readonly l1Client: InsuredBridgeL1Client,
    readonly l2Client: InsuredBridgeL2Client,
    readonly bridgeAdapter: BridgeAdapterInterface,
    readonly account: string,
    readonly l2DeployData: { [key: string]: { blockNumber: number } },
    readonly crossDomainFinalizationThreshold: number = 5
  ) {}
  async checkForBridgeableL2TokensAndBridge() {
    this.logger.debug({ at: "CrossDomainFinalizer", message: "Checking bridgeable L2 tokens" });

    // Fetch all whitelisted tokens on the particular l2 chainId. Remove the DAI Optimism address from the whitelist as
    // we don't want to finalize DAI actions due to this not working over the canonical Optimism bridge.
    const whitelistedL2Tokens = this.l1Client
      .getWhitelistedL2TokensForChainId(this.l2Client.chainId.toString())
      .filter((address) => address !== "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1"); // Remove DAI on Optimism address.

    // Check if any of the whitelisted l2Tokens are bridgeable. Do this in one parallel call. Returns an array of bool
    // for each l2Token, describing if it can be bridged from L2->L1.
    const canBridge = await Promise.all(
      whitelistedL2Tokens.map((l2Token) => this.l2Client.bridgeDepositBox.methods.canBridge(l2Token).call())
    );

    // For each canBridge result, check if it is true. If so, then we can bridge the token.
    const bridgeableL2Tokens = whitelistedL2Tokens.filter((_, index) => canBridge[index]);

    // Finally, iterate over the bridgeable l2Tokens and bridge them.
    if (bridgeableL2Tokens.length == 0) {
      this.logger.debug({ at: "CrossDomainFinalizer", message: "No bridgeable L2 tokens" });
      return;
    }
    // Track the account nonce and manually increment on each TX. We need to do this because the L2 transactions
    // process quicker than the infura node updates and we need to avoid the nonce collision.
    let nonce = await this.l2Client.l2Web3.eth.getTransactionCount(this.account);
    for (const l2Token of bridgeableL2Tokens) {
      // For each bridgeable L2Token, check the balance in the deposit box. If it is greater than
      // crossDomainFinalizationThreshold, as a percentage, then we can bridge it. If the liquidity utilization is
      // greater than 75% then set the crossDomainFinalizationThreshold to half its set value to send funds more
      // aggressively over the bridge at high utilizations.

      try {
        const { symbol, decimals, l2PoolBalance } = await this._getL2TokenInfo(l2Token);
        const l1PoolReserves = await this._getL1PoolReserves(l2Token);
        const l1PoolUtilization = await this._getL1PoolUtilization(l2Token);

        const scaledCrossDomainFinalizationThreshold = l1PoolUtilization.gt(toBNWei("0.75"))
          ? toBNWei(this.crossDomainFinalizationThreshold.toString()).divn(2)
          : toBNWei(this.crossDomainFinalizationThreshold.toString());

        if (l2PoolBalance.gt(scaledCrossDomainFinalizationThreshold.mul(l1PoolReserves).div(toBNWei("100")))) {
          this.logger.debug({
            at: "CrossDomainFinalizer",
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
            at: "CrossDomainFinalizer",
            message: "L2 balance <= cross domain finalization threshold % of L1 pool reserves, skipping",
            l2Token,
            l2PoolBalance: l2PoolBalance.toString(),
            l1PoolReserves: l1PoolReserves.toString(),
            crossDomainFinalizationThresholdPercent: this.crossDomainFinalizationThreshold,
          });
        }
      } catch (error) {
        this.logger.error({
          at: "CrossDomainFinalizer",
          message: "Something errored sending tokens over the canonical bridge!",
          error,
          notificationPath: "across-infrastructure",
        });
      }
    }
  }

  async checkForConfirmedL2ToL1RelaysAndFinalize() {
    // Fetch all whitelisted L2 tokens. Append the ETH address on Optimism to the whitelist to enable finalization of
    // Optimism -> Ethereum bridging actions. This is needed as we send ETH over the Optimism bridge, not WETH.
    // Also, remove the DAI Optimism address from the whitelist as we don't want to finalize DAI transfer.
    const whitelistedL2Tokens = [
      ...this.l1Client.getWhitelistedL2TokensForChainId(this.l2Client.chainId.toString()),
      "0xDeadDeAddeAddEAddeadDEaDDEAdDeaDDeAD0000", // Append L2ETH on Optimism address.
    ].filter((address) => address !== "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1"); // Remove DAI on Optimism address.

    // Fetch TokensBridged events.
    await this.fetchTokensBridgedEvents();

    // For each whitelisted L2 token, fetch all associated "TokensBridge" transaction hashes on L2. This will return an
    // array of arrays, with each L2 token's transaction hashes being the nested array to each L2Token.
    const l2TokensBridgedTransactions = whitelistedL2Tokens
      .map((l2Token) => this.getTokensBridgedTransactionsForL2Token(l2Token))
      .flat() // Flatten the array to get a 1D array of all TokenBridged transaction hashes.
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
        at: "CrossDomainFinalizer",
        message: `Canonical bridge initiated! 🌁`,
        mrkdwn:
          createFormatFunction(2, 4, false, decimals)(tokensSent) +
          " " +
          symbol +
          " was sent over the canonical " +
          PublicNetworks[this.l2Client.chainId]?.name +
          " bridge. tx: " +
          createEtherscanLinkMarkdown(receipt.transactionHash, this.l2Client.chainId),
        notificationPath: "across-infrastructure",
      });
    }
  }

  // Executes a confirmed L2->L1 relay transaction over the canonical bridge.
  private async executeConfirmedL2ToL1Relay(l2TransactionHash: string, finalizationTransaction: TransactionType) {
    try {
      // Fetch info about the TokensBridged transaction to populate logs.
      const l2Token = this._getL2TokenForTokensBridgedTransactionHash(l2TransactionHash);
      const tokensBridged = this._getTokensBridgedForTokenBridgeTransactionHash(l2Token, l2TransactionHash);
      const { symbol, decimals } = await this._getL2TokenInfo(l2Token);

      await this.gasEstimator.update();
      const executionResult = await runTransaction({
        web3: this.l1Client.l1Web3,
        transaction: finalizationTransaction,
        transactionConfig: { ...this.gasEstimator.getCurrentFastPrice(), from: this.account },
        availableAccounts: 1,
        waitForMine: false,
      });

      this.logger.info({
        at: "CrossDomainFinalizer",
        message: `Canonical relay finalized 🪄`,
        mrkdwn:
          "Canonical L2->L1 transfer over the " +
          PublicNetworks[this.l2Client.chainId]?.name +
          " bridge has been finalized! A total of " +
          createFormatFunction(2, 4, false, decimals)(tokensBridged) +
          " " +
          symbol +
          " was bridged. L2 TokensBridged tx: " +
          createEtherscanLinkMarkdown(l2TransactionHash, this.l2Client.chainId) +
          ". tx: " +
          createEtherscanLinkMarkdown(executionResult.transactionHash),
        notificationPath: "across-infrastructure",
      });
      this.executedL1Transactions.push(executionResult);
    } catch (error) {
      this.logger.error({
        at: "CrossDomainFinalizer",
        message: "Something errored sending a transaction",
        error,
        notificationPath: "across-infrastructure",
      });
    }
  }

  async fetchTokensBridgedEvents() {
    // Note that the query below only works on particular RPC endpoints. Infura, for example, is limited to a 100k look
    // back. This means that to use this module you need to use an endpoint that supports longer lookbacks, such as
    // alchemy, which supports arbitrary long loobacks. In future, Infura will support arbitrary long lookbacks.
    // Note2: the blockOffset is added to limit how far forward we look. We want to ideally ignore the newest blocks
    // as these can causes errors in the Bridge Adapters if the L2 transactions are not yet checkpointed on the
    // canonical L1 StateCommitmentChain. 5000 blocks is ~ 3 hours at current Optimism rate. This is only applied if we
    // are not running in test mode.
    const blockOffset =
      argv._.indexOf("test") !== -1 || argv._.filter((arg) => arg.includes("mocha")).length > 0
        ? 0
        : across.constants.L2_STATE_COMMITMENT_DELAY_BLOCKS;
    const tokensBridgedEvents = await this.l2Client.bridgeDepositBox.getPastEvents("TokensBridged", {
      fromBlock: this.l2DeployData[this.l2Client.chainId].blockNumber,
      toBlock: (await this.l2Client.l2Web3.eth.getBlockNumber()) - blockOffset,
    });
    for (const tokensBridgedEvent of tokensBridgedEvents) {
      // If this is the first time we are seeing this L2 token then create the array.
      if (!this.tokensBridgedTransactions[tokensBridgedEvent.returnValues.l2Token])
        this.tokensBridgedTransactions[tokensBridgedEvent.returnValues.l2Token] = [];
      // Only add the element to the array if we dont already have this bridgedTokensTxHash. We would already have this
      // tx hash if this we had re-run this function more than once. This would be the case in non-serverless mode.
      if (
        !this.tokensBridgedTransactions[tokensBridgedEvent.returnValues.l2Token].some(
          (bridgedEvent) => bridgedEvent.bridgedTokensTxHash === tokensBridgedEvent.transactionHash
        )
      )
        this.tokensBridgedTransactions[tokensBridgedEvent.returnValues.l2Token].push({
          bridgedTokensTxHash: tokensBridgedEvent.transactionHash,
          numberOfTokens: tokensBridgedEvent.returnValues.numberOfTokensBridged,
        });
    }
  }

  getTokensBridgedTransactionsForL2Token(l2TokenAddress: string) {
    if (!this.tokensBridgedTransactions[l2TokenAddress]) return [];
    return this.tokensBridgedTransactions[l2TokenAddress].map(
      (tokensBridgedTransaction: TokensBridged) => tokensBridgedTransaction.bridgedTokensTxHash
    );
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

  // Fetch L1 pool reserves for a given l2Token.
  private async _getL1PoolUtilization(l2Token: string): Promise<BN> {
    const bridgePool = this.l1Client.getBridgePoolForL2Token(l2Token, this.l2Client.chainId.toString()).contract;

    return toBN(await bridgePool.methods.liquidityUtilizationCurrent().call());
  }

  private _getL2TokenForTokensBridgedTransactionHash(tokensBridgedTransaction: string) {
    let foundL2TokenAddress = "";
    Object.keys(this.tokensBridgedTransactions).forEach((l2TokenAddress: string) => {
      if (
        this.tokensBridgedTransactions[l2TokenAddress]
          .map((tokensBridged: TokensBridged) => tokensBridged.bridgedTokensTxHash)
          .includes(tokensBridgedTransaction)
      ) {
        foundL2TokenAddress = l2TokenAddress;
      }
    });
    return foundL2TokenAddress;
  }

  private _getTokensBridgedForTokenBridgeTransactionHash(l2TokenAddress: string, tokenBridgeTransaction: string) {
    const tokensBridgedIndex = this.tokensBridgedTransactions[l2TokenAddress]
      .map((tokensBridged: TokensBridged) => tokensBridged.bridgedTokensTxHash)
      .indexOf(tokenBridgeTransaction);

    return this.tokensBridgedTransactions[l2TokenAddress][tokensBridgedIndex].numberOfTokens;
  }
}
