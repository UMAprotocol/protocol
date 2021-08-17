import { Contract, EventData } from "web3-eth-contract";
import { runTransaction, POLYGON_MESSAGE_SENT_EVENT_SIG } from "@uma/common";
import type Web3 from "web3";

export class Relayer {
  constructor(
    readonly logger: any,
    readonly account: string,
    readonly gasEstimator: any,
    readonly maticPosClient: any,
    readonly oracleChildTunnel: Contract,
    readonly oracleRootTunnel: Contract,
    readonly web3: Web3,
    readonly ethEarliestBlockToQuery: number,
    readonly polygonEarliestBlockToQuery: number
  ) {
    this.oracleChildTunnel = oracleChildTunnel;
    this.oracleRootTunnel = oracleRootTunnel;
    this.maticPosClient = maticPosClient;
    this.ethEarliestBlockToQuery = ethEarliestBlockToQuery;
    this.polygonEarliestBlockToQuery = polygonEarliestBlockToQuery;
    this.web3 = web3;
    this.gasEstimator = gasEstimator;
    this.account = account;
  }

  // In order to receive a message on Ethereum from Polygon, `receiveMessage` must be called on the Root Tunnel contract
  // with a proof derived from the Polygon transaction hash that was checkpointed to Mainnet.
  async relayMessage() {
    this.logger.debug({
      at: "Relayer",
      message: "Checking for Polygon oracle messages that can be relayed to Ethereum",
      polygonEarliestBlockToQuery: this.polygonEarliestBlockToQuery,
      ethEarliestBlockToQuery: this.ethEarliestBlockToQuery,
      oracleChildTunnel: this.oracleChildTunnel.options.address,
      oracleRootTunnel: this.oracleRootTunnel.options.address,
    });

    // First, query OracleChildTunnel on Polygon for any MessageSent events.
    const messageSentEvents = await this.oracleChildTunnel.getPastEvents("MessageSent", {
      fromBlock: this.polygonEarliestBlockToQuery,
    });
    this.logger.info({
      at: "Relayer",
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
        at: "Relayer",
        message: "No MessageSent events emitted by OracleChildTunnel, exiting",
      });
      return;
    }
  }

  // First check if the transaction hash corresponding to the MessageSent event has been checkpointed to Ethereum
  // Mainnet yet. If it has, then derive a Polygon-specific proof for it and execute OracleRootTunnel.receiveMessage
  // by passing in the proof as input.
  async _relayMessage(messageEvent: EventData) {
    const transactionHash = messageEvent.transactionHash;
    this.logger.debug({
      at: "Relayer",
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
