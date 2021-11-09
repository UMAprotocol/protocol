import winston from "winston";

import { createEtherscanLinkMarkdown, createFormatFunction, PublicNetworks } from "@uma/common";
import { getAbi } from "@uma/contracts-node";
import { InsuredBridgeL1Client, InsuredBridgeL2Client, GasEstimator } from "@uma/financial-templates-lib";

export enum RelaySubmitType {
  Slow,
  SpeedUp,
  Instant,
  Ignore,
}

export class CrossDomainFinalizer {
  constructor(
    readonly logger: winston.Logger,
    readonly gasEstimator: GasEstimator,
    readonly l1Client: InsuredBridgeL1Client,
    readonly l2Client: InsuredBridgeL2Client,
    readonly account: string
  ) {}
  async checkForBridgeableL2TokensAndBridge() {
    this.logger.debug({ at: "AcrossRelayer#CrossDomainFinalizer", message: "Checking bridgeable L2 tokens" });

    const whitelistedTokenEvents = await this.l1Client.bridgeAdmin.getPastEvents("WhitelistToken", {
      fromBlock: 0,
      toBlock: await this.l1Client.l1Web3.eth.getBlockNumber(),
    });

    // Extract the l2Tokens that have been whitelisted. The new Set syntax acts to remove any duplicates from the array.
    // This would be the case if a l2 token was re - whitelisted after upgrading the bridgePool contract on L1.
    const whitelistedL2Tokens = [...new Set(whitelistedTokenEvents.map((event) => event.returnValues.l2Token))];

    // Check if any of the whitelisted l2Tokens are bridgeable. Do this in one parallel call. Returns an array of bool
    // for each l2Token, describing if it can be bridged from L2->L1.
    const canBridge = await Promise.all(
      whitelistedL2Tokens.map((l2Token) => this.l2Client.bridgeDepositBox.methods.canBridge(l2Token).call())
    );

    // For each canBridge result, check if it is true. If so, then we can bridge the token.
    const bridgeableL2Tokens = whitelistedL2Tokens.filter((l2Token, index) => canBridge[index]);

    // Finally, iterate over the bridgeable l2Tokens and bridge them.
    if (bridgeableL2Tokens.length == 0) {
      this.logger.debug({ at: "AcrossRelayer#CrossDomainFinalizer", message: "No bridgeable L2 tokens" });
      return;
    }
    const nonce = await this.l2Client.l2Web3.eth.getTransactionCount(this.account);
    for (const l2Token of bridgeableL2Tokens) {
      // Track the account nonce and manually increment on each TX. We need to do this because the L2 transactions
      // process quicker than the infura node updates and we need to avoid the nonce collision.
      try {
        this._bridgeL2Token(l2Token, nonce);
      } catch (error) {
        this.logger.error({
          at: "AcrossRelayer#CrossDomainFinalizer",
          message: "Something errored sending tokens over the canonical bridge!",
          error,
        });
      }
    }
  }
  // TODO
  // async checkForFinalizedCanonicalRelaysAndFinalize() {}

  private async _bridgeL2Token(l2Token: string, nonce: number) {
    // Note that this tx sending method is NOT using TransactionUtils runTransaction as it is not required on L2.
    const receipt = await this.l2Client.bridgeDepositBox.methods
      .bridgeTokens(l2Token, "0") // The second term in this function call is l2Gas, which is currently unused.
      .send({ from: this.account, nonce });
    nonce += 1;

    const l2TokenInstance = new this.l2Client.l2Web3.eth.Contract(getAbi("ERC20"), l2Token);

    const [tokenSymbol, tokenDecimals] = await Promise.all([
      l2TokenInstance.methods.symbol().call(),
      l2TokenInstance.methods.decimals().call(),
    ]);
    if (receipt.events) {
      const tokensSent = receipt.events.TokensBridged.returnValues.numberOfTokensBridged;
      this.logger.info({
        at: "AcrossRelayer#CrossDomainFinalizer",
        message: `L2 ${tokenSymbol} bridged over the canonical bridge! 🌁`,
        mrkdwn:
          createFormatFunction(2, 4, false, tokenDecimals)(tokensSent) +
          " " +
          tokenSymbol +
          " was sent over the canonical " +
          PublicNetworks[this.l2Client.chainId]?.name +
          " bridge. tx: " +
          createEtherscanLinkMarkdown(receipt.transactionHash, this.l2Client.chainId),
      });
    }
  }
}
