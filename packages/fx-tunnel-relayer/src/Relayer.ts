import { Contract, EventData } from "web3-eth-contract";
import { runTransaction } from "@uma/common";
import type Web3 from "web3";

// Used by Matic/Polygon PoS client to construct proof for arbitrary message from Polygon that can be submitted to
// Ethereum to relay a cross chain message.
// - Source: https://github.com/maticnetwork/matic.js/blob/564c5502d856c2b1870f4b3ff465df70ade47d2e/src/root/POSRootChainManager.ts#L15
const POLYGON_MESSAGE_SENT_EVENT_SIG = "0x8c5261668696ce22758910d05bab8f186d6eb247ceac2af2e82c7dc17669b036";

export class Relayer {
  constructor(
    readonly logger: any,
    readonly account: string,
    readonly gasEstimator: any,
    readonly maticPosClient: any,
    readonly oracleChildTunnel: Contract,
    readonly oracleRootTunnel: Contract,
    readonly web3: Web3,
    readonly polygonEarliestBlockToQuery: number
  ) {}

  // In order to receive a message on Ethereum from Polygon, `receiveMessage` must be called on the Root Tunnel contract
  // with a proof derived from the Polygon transaction hash that was checkpointed to Mainnet.
  async fetchAndRelayMessages(): Promise<void> {
    this.logger.debug({
      at: "Relayer#relayMessage",
      message: "Checking for Polygon oracle messages that can be relayed to Ethereum",
      polygonEarliestBlockToQuery: this.polygonEarliestBlockToQuery,
      oracleChildTunnel: this.oracleChildTunnel.options.address,
      oracleRootTunnel: this.oracleRootTunnel.options.address,
    });

    // First, query OracleChildTunnel on Polygon for any MessageSent events.
    // For some reason, the fromBlock filter doesn't work on local hardhat tests so I added this filter to explicitly
    // remove events with block numbers older than the window.
    const messageSentEvents: EventData[] = (
      await this.oracleChildTunnel.getPastEvents("MessageSent", {
        fromBlock: this.polygonEarliestBlockToQuery,
      })
    ).filter((e: EventData) => e.blockNumber >= this.polygonEarliestBlockToQuery);
    this.logger.debug({
      at: "Relayer#relayMessage",
      message: "Found MessageSent events",
      polygonEarliestBlockToQuery: this.polygonEarliestBlockToQuery,
      eventCount: messageSentEvents.length,
    });
    // For any found events, grab its block number and check whether it has been checkpointed yet to the
    // CheckpointManager on Ethereum.
    if (messageSentEvents.length > 0) {
      for (const e of messageSentEvents) {
        await this._relayMessage(e);
      }
    } else {
      this.logger.debug({
        at: "Relayer#relayMessage",
        message: "No MessageSent events emitted by OracleChildTunnel, exiting",
      });
      return;
    }
  }

  // First check if the transaction hash corresponding to the MessageSent event has been checkpointed to Ethereum
  // Mainnet yet. If it has, then derive a Polygon-specific proof for it and execute OracleRootTunnel.receiveMessage
  // by passing in the proof as input.
  async _relayMessage(messageEvent: EventData): Promise<void> {
    const transactionHash = messageEvent.transactionHash;
    this.logger.debug({
      at: "Relayer#relayMessage",
      message: "Deriving proof for transaction that emitted MessageSent",
      transactionHash: transactionHash,
      blockNumber: messageEvent.blockNumber,
    });

    // This method will fail if the Polygon transaction hash has not been checkpointed to Mainnet yet. Checkpoints
    // happen roughly every hour.
    let proof;
    try {
      // Proof construction logic copied from:
      // - https://docs.matic.network/docs/develop/l1-l2-communication/state-transfer#state-transfer-from-matic-to-ethereum
      proof = await this.maticPosClient.posRootChainManager.customPayload(
        transactionHash,
        POLYGON_MESSAGE_SENT_EVENT_SIG // SEND_MESSAGE_EVENT_SIG, do not change
      );
      if (!proof) throw new Error("Proof construction succeeded but returned undefined");
    } catch (error) {
      // If event block hasn't been checkpointed to Mainnet yet, then don't emit error level log.
      let logLevel = "error";
      if (error.message.includes("transaction has not been checkpointed")) logLevel = "debug";
      this.logger[logLevel]({
        at: "Relayer#relayMessage",
        message: "Failed to derive proof for MessageSent transaction hash 📛",
        messageEvent,
        error,
      });
      return;
    }

    // Simulate and submit receiveMessage transaction with proof as input.
    this.logger.debug({
      at: "Relayer#relayMessage",
      message: "Submitting proof",
      proof: proof,
      account: this.account,
    });
    try {
      const { receipt } = await runTransaction({
        web3: this.web3,
        transaction: this.oracleRootTunnel.methods.receiveMessage(proof),
        transactionConfig: { gasPrice: this.gasEstimator.getCurrentFastPrice(), from: this.account },
        availableAccounts: 1,
      });
      this.logger.info({
        at: "Relayer#relayMessage",
        message: "Submitted relay proof!🕴🏼",
        tx: receipt.transactionHash,
        messageEvent,
      });
    } catch (error) {
      // If the proof was already submitted, then don't emit an error level log.
      let logLevel = "error";
      if (error.message.includes("EXIT_ALREADY_PROCESSED")) logLevel = "debug";
      this.logger[logLevel]({
        at: "Relayer#relayMessage",
        message: "Failed to submit proof to root tunnel🚨",
        error,
      });
      return;
    }
  }
}
module.exports = { Relayer };
