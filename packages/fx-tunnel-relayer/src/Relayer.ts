import { Contract, EventData } from "web3-eth-contract";
import { runTransaction, getEventsWithPaginatedBlockSearch } from "@uma/common";
import type Web3 from "web3";
import { safeErrorMessage } from "./safeErrorMessage";
import { MAX_CHUNK_SIZE, SplitExitPayload, chunkHex, splitExitPayload } from "./exitPayload";

import { BASE_FEE_MULTIPLIER, MAX_PRIORITY_FEE_PER_GAS_WEI } from "./constants";

// Used by Matic/Polygon PoS client to construct proof for arbitrary message from Polygon that can be submitted to
// Ethereum to relay a cross chain message.
// - Source: https://github.com/maticnetwork/matic.js/blob/564c5502d856c2b1870f4b3ff465df70ade47d2e/src/root/POSRootChainManager.ts#L15
const POLYGON_MESSAGE_SENT_EVENT_SIG = "0x8c5261668696ce22758910d05bab8f186d6eb247ceac2af2e82c7dc17669b036";

const calldataLength = (transaction: { encodeABI: () => string }): number => (transaction.encodeABI().length - 2) / 2;
const isEmptyCode = (code: string | null | undefined): boolean => !code || code === "0x";
// EIP-7825 per-transaction gas limit cap on Ethereum.
export const MAX_TRANSACTION_GAS = 16_777_216;
// runTransaction sends with a gas limit of the estimate times this buffer.
const RUN_TRANSACTION_GAS_LIMIT_BUFFER = 1.25;

export class Relayer {
  private readonly warnedOversizeMessages = new Set<string>();
  // Chunk data contract addresses known to be deployed, to skip on-chain lookups for chunks shared between messages.
  private readonly storedChunks = new Set<string>();
  private readonly reportedTooLargeMessages = new Set<string>();
  constructor(
    readonly logger: any,
    readonly account: string,
    readonly maticPosClient: any,
    readonly oracleChildTunnel: Contract,
    readonly oracleRootTunnel: Contract,
    readonly web3: Web3,
    readonly polygonWeb3: Web3,
    readonly polygonEarliestBlockToQuery: number,
    readonly polygonLatestBlockToQuery: number,
    readonly maxCalldataBytes = 120_000,
    // Optional RootTunnelChunkedRelayer used for proofs above maxCalldataBytes. If undefined, they are skipped with a warn.
    readonly chunkedRelayer?: Contract,
    // Proofs above this size are not relayed through the chunked relayer: the root tunnel would need more gas than the
    // per-transaction cap to process them, so storing their chunks would only waste gas.
    readonly maxChunkedProofBytes = 360_000
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
    const { eventData, web3RequestCount } = await getEventsWithPaginatedBlockSearch(
      this.oracleChildTunnel,
      "MessageSent",
      this.polygonEarliestBlockToQuery,
      this.polygonLatestBlockToQuery,
      3490 // Polygon Infura RPC limits you to 3500 blocks
    );
    // This .filter shouldn't be neccessary and it isn't in prod (empirically) but for some reason without this it
    // fails the test "ignores events older than earliest polygon block to query"
    const messageSentEvents = eventData.filter((e: EventData) => e.blockNumber >= this.polygonEarliestBlockToQuery);
    this.logger.debug({
      at: "Relayer#relayMessage",
      message: "Found MessageSent events",
      polygonEarliestBlockToQuery: this.polygonEarliestBlockToQuery,
      eventCount: messageSentEvents.length,
      web3RequestCount,
    });
    // For any found events, grab its block number and check whether it has been checkpointed yet to the
    // CheckpointManager on Ethereum.
    if (messageSentEvents.length > 0) {
      // A single Polygon transaction can contain multiple MessageSent events, e.g. two price requests bridged
      // atomically. matic.js builds the exit proof for the i-th log matching the MessageSent signature within the
      // transaction (defaulting to the first one), so each event must be proven at its own index or every event in
      // the transaction would produce a proof for the first message and the rest would never be relayed.
      const messageSentLogIndicesByTxHash: { [transactionHash: string]: number[] } = {};
      for (const e of messageSentEvents) {
        if (messageSentLogIndicesByTxHash[e.transactionHash] === undefined) {
          const logIndices = await this._getMessageSentLogIndices(e.transactionHash);
          if (logIndices === undefined) continue;
          messageSentLogIndicesByTxHash[e.transactionHash] = logIndices;
        }
        const messageIndex = messageSentLogIndicesByTxHash[e.transactionHash].indexOf(e.logIndex);
        if (messageIndex === -1) {
          this.logger.error({
            at: "Relayer#relayMessage",
            message: "Could not find MessageSent event's log index in its transaction receipt 📛",
            transactionHash: e.transactionHash,
            logIndex: e.logIndex,
          });
          continue;
        }
        await this._relayMessage(e, messageIndex);
      }
    } else {
      this.logger.debug({
        at: "Relayer#relayMessage",
        message: "No MessageSent events emitted by OracleChildTunnel, exiting",
      });
      return;
    }
  }

  // Returns the log indices of all MessageSent events in a Polygon transaction, in order. The receipt is read from the
  // Polygon provider since the transaction lives on the child chain. Returns undefined, after logging, if the receipt
  // cannot be fetched (e.g. after a reorg or when the node is lagging) so the caller can move on to the next event.
  async _getMessageSentLogIndices(transactionHash: string): Promise<number[] | undefined> {
    let receipt;
    try {
      receipt = await this.polygonWeb3.eth.getTransactionReceipt(transactionHash);
      if (!receipt) throw new Error("Transaction receipt not found");
    } catch (error) {
      this.logger.error({
        at: "Relayer#relayMessage",
        message: "Failed to fetch receipt for MessageSent transaction hash 📛",
        transactionHash,
        error: safeErrorMessage(error),
      });
      return undefined;
    }
    return receipt.logs
      .filter((log) => log.topics.length > 0 && log.topics[0].toLowerCase() === POLYGON_MESSAGE_SENT_EVENT_SIG)
      .map((log) => log.logIndex);
  }

  // First check if the transaction hash corresponding to the MessageSent event has been checkpointed to Ethereum
  // Mainnet yet. If it has, then derive a Polygon-specific proof for it and execute OracleRootTunnel.receiveMessage
  // by passing in the proof as input. `messageIndex` is the position of this event among all logs matching the
  // MessageSent signature in the transaction, used to prove the correct log when a transaction contains several.
  async _relayMessage(messageEvent: EventData, messageIndex: number): Promise<void> {
    const transactionHash = messageEvent.transactionHash;
    const blockNumber = messageEvent.blockNumber;

    const isCheckpointed = await this.maticPosClient.exitUtil.isCheckPointed(transactionHash);
    if (!isCheckpointed) {
      // Polygon block containing MessageSent event hasn't been checkpointed to Mainnet yet. Checkpoints
      // happen roughly every hour.
      this.logger.debug({
        at: "Relayer#relayMessage",
        message: "MessageSent event block not checkpointed to mainnet yet ⚠️",
        transactionHash,
        blockNumber,
      });
      return;
    }

    this.logger.debug({
      at: "Relayer#relayMessage",
      message: "Deriving proof for transaction that emitted MessageSent",
      transactionHash: transactionHash,
      blockNumber,
      messageIndex,
    });

    let proof;
    try {
      // Proof construction logic copied from:
      // - https://maticnetwork.github.io/matic.js/docs/advanced/exit-util/
      proof = await this.maticPosClient.exitUtil.buildPayloadForExit(
        transactionHash,
        POLYGON_MESSAGE_SENT_EVENT_SIG, // SEND_MESSAGE_EVENT_SIG, do not change
        false,
        messageIndex
      );
      if (!proof) throw new Error("Proof construction succeeded but returned undefined");
    } catch (error) {
      this.logger.error({
        at: "Relayer#relayMessage",
        message: "Failed to derive proof for MessageSent transaction hash 📛",
        transactionHash,
        blockNumber,
        logIndex: messageEvent.logIndex,
        messageIndex,
        error: safeErrorMessage(error),
      });
      return;
    }

    try {
      const transaction = this.oracleRootTunnel.methods.receiveMessage(proof);
      const calldataBytes = calldataLength(transaction);
      if (calldataBytes > this.maxCalldataBytes) {
        await this._handleOversizeProof(proof, transactionHash, messageIndex, calldataBytes);
        return;
      }
      this.logger.debug({
        at: "Relayer#relayMessage",
        message: "Submitting proof",
        transactionHash,
        messageIndex,
        calldataBytes,
        account: this.account,
      });
      const gasFees = await this._getGasFees();
      const { transactionHash: relayTransactionHash } = await runTransaction({
        web3: this.web3,
        transaction,
        transactionConfig: { ...gasFees, from: this.account },
        availableAccounts: 1,
        // gasFees already leaves headroom over the base fee, so send maxFeePerGas as is rather than doubling it.
        maxFeePerGasMultiplier: 1,
      });
      this.logger.info({
        at: "Relayer#relayMessage",
        message: "Submitted relay proof!🕴🏼",
        tx: relayTransactionHash,
        polygonTransactionHash: messageEvent.transactionHash,
        blockNumber,
        logIndex: messageEvent.logIndex,
        messageIndex,
      });
    } catch (error) {
      // If the proof was already submitted, then don't emit an error level log.
      if (safeErrorMessage(error).includes("EXIT_ALREADY_PROCESSED")) {
        this.logger.debug({
          at: "Relayer#relayMessage",
          message: "Exit proof already processed by root tunnel, skipping",
          transactionHash,
          messageIndex,
        });
        return;
      }
      this.logger.error({
        at: "Relayer#relayMessage",
        message: "Failed to submit proof to root tunnel🚨",
        transactionHash,
        messageIndex,
        error: safeErrorMessage(error),
      });
      return;
    }
  }

  // Handles a proof whose receiveMessage calldata exceeds maxCalldataBytes. Already processed exits are skipped. With a
  // chunked relayer configured the proof is relayed through it; otherwise (or if the payload cannot be parsed) a warn is
  // logged once per message so that it can be relayed manually. Errors thrown here are handled by the caller's catch.
  async _handleOversizeProof(
    proof: string,
    transactionHash: string,
    messageIndex: number,
    calldataBytes: number
  ): Promise<void> {
    let payload: SplitExitPayload | undefined;
    let parseError: string | undefined;
    try {
      payload = splitExitPayload(proof);
    } catch (error) {
      parseError = safeErrorMessage(error);
    }

    if (payload) {
      let processed: boolean | undefined;
      try {
        processed = await this.oracleRootTunnel.methods.processedExits(payload.exitHash).call();
      } catch (error) {
        // Without the precheck, storing chunks could waste gas on an exit that is already processed.
        if (this.chunkedRelayer) throw error;
        this.logger.debug({
          at: "Relayer#relayMessage",
          message: "Failed to check whether oversize exit was processed",
          transactionHash,
          messageIndex,
          error: safeErrorMessage(error),
        });
      }
      if (processed) {
        this.logger.debug({
          at: "Relayer#relayMessage",
          message: "Oversize exit already processed by root tunnel, skipping",
          transactionHash,
          messageIndex,
          exitHash: payload.exitHash,
        });
        return;
      }
      if (this.chunkedRelayer) {
        const proofBytes = (proof.length - 2) / 2;
        if (proofBytes > this.maxChunkedProofBytes) {
          const key = `${transactionHash}:${messageIndex}`;
          if (!this.reportedTooLargeMessages.has(key)) {
            this.logger.error({
              at: "Relayer#relayMessage",
              message: "Proof too large to relay on Ethereum: needs DVM request outside the tunnel",
              transactionHash,
              messageIndex,
              proofBytes,
              maxChunkedProofBytes: this.maxChunkedProofBytes,
            });
            this.reportedTooLargeMessages.add(key);
          }
          return;
        }
        await this._relayChunked(this.chunkedRelayer, payload, transactionHash, messageIndex, proofBytes);
        return;
      }
    }

    const key = `${transactionHash}:${messageIndex}`;
    if (!this.warnedOversizeMessages.has(key)) {
      this.logger.warn({
        at: "Relayer#relayMessage",
        message: "Oversize relay calldata: needs manual relay",
        transactionHash,
        messageIndex,
        calldataBytes,
        ...(this.chunkedRelayer ? { error: `Could not parse exit payload: ${parseError}` } : {}),
      });
      this.warnedOversizeMessages.add(key);
    }
  }

  // Relays an oversize proof through RootTunnelChunkedRelayer: stores the payload body (items 0..8) in data contracts of
  // at most MAX_CHUNK_SIZE bytes, then calls relay(prefix, chunks, suffix), which calls receiveMessage with the rebuilt
  // proof. Chunks are content addressed (CREATE2 with salt keccak256(chunk)), so chunks already on chain, e.g. stored
  // for another message of the same Polygon transaction or by an earlier interrupted run, are reused and not re-sent.
  async _relayChunked(
    chunkedRelayer: Contract,
    payload: SplitExitPayload,
    transactionHash: string,
    messageIndex: number,
    proofBytes: number
  ): Promise<void> {
    const chunks = chunkHex(payload.body, MAX_CHUNK_SIZE);
    const pointers: string[] = [];
    let chunksStored = 0;
    let chunksReused = 0;
    for (const chunk of chunks) {
      const pointer: string = await chunkedRelayer.methods.chunkAddress(chunk).call();
      if (this.storedChunks.has(pointer) || !isEmptyCode(await this.web3.eth.getCode(pointer))) {
        chunksReused++;
      } else {
        const transaction = chunkedRelayer.methods.storeChunk(chunk);
        this._assertCalldataWithinLimit(transaction, "storeChunk");
        const gasFees = await this._getGasFees();
        await runTransaction({
          web3: this.web3,
          transaction,
          transactionConfig: { ...gasFees, from: this.account },
          availableAccounts: 1,
          maxFeePerGasMultiplier: 1,
        });
        // runTransaction waits for the receipt, so a failed store throws before the pointer is recorded.
        chunksStored++;
      }
      this.storedChunks.add(pointer);
      pointers.push(pointer);
    }

    const transaction = chunkedRelayer.methods.relay(payload.prefix, pointers, payload.suffix);
    this._assertCalldataWithinLimit(transaction, "relay");
    const relayContext = {
      transactionHash,
      messageIndex,
      proofBytes,
      chunkCount: pointers.length,
      chunksStored,
      chunksReused,
    };
    this.logger.debug({
      at: "Relayer#relayMessage",
      message: "Submitting chunked proof",
      ...relayContext,
      account: this.account,
    });
    let relayTransactionHash: string;
    try {
      // runTransaction simulates the relay before sending, so a revert or out-of-gas fails here without spending gas.
      // Its gas limit is the estimate times RUN_TRANSACTION_GAS_LIMIT_BUFFER, which must also fit the per-transaction
      // cap or nodes reject the transaction, so check that first for a clear error.
      const estimatedGas = await transaction.estimateGas({ from: this.account });
      if (Math.floor(estimatedGas * RUN_TRANSACTION_GAS_LIMIT_BUFFER) > MAX_TRANSACTION_GAS) {
        throw new Error(
          `relay gas estimate ${estimatedGas} with a ${RUN_TRANSACTION_GAS_LIMIT_BUFFER}x buffer exceeds the ` +
            `${MAX_TRANSACTION_GAS} per-transaction gas cap; lower MAX_CHUNKED_PROOF_BYTES`
        );
      }
      const gasFees = await this._getGasFees();
      ({ transactionHash: relayTransactionHash } = await runTransaction({
        web3: this.web3,
        transaction,
        transactionConfig: { ...gasFees, from: this.account },
        availableAccounts: 1,
        maxFeePerGasMultiplier: 1,
      }));
    } catch (error) {
      // Already processed exits are logged at debug level by the caller.
      if (safeErrorMessage(error).includes("EXIT_ALREADY_PROCESSED")) throw error;
      // The stored chunks stay on chain and are reused, so later runs only repeat the simulation.
      this.logger.error({
        at: "Relayer#relayMessage",
        message: "Chunked relay failed after storing chunks🚨",
        ...relayContext,
        error: safeErrorMessage(error),
      });
      return;
    }
    this.logger.info({
      at: "Relayer#relayMessage",
      message: "Submitted chunked relay proof!🕴🏼",
      tx: relayTransactionHash,
      polygonTransactionHash: transactionHash,
      messageIndex,
      proofBytes,
      chunkCount: pointers.length,
      chunksStored,
      chunksReused,
    });
  }

  _assertCalldataWithinLimit(transaction: { encodeABI: () => string }, method: string): void {
    const bytes = calldataLength(transaction);
    if (bytes > this.maxCalldataBytes) {
      throw new Error(`${method} calldata of ${bytes} bytes exceeds MAX_CALLDATA_BYTES ${this.maxCalldataBytes}`);
    }
  }

  // Prices the receiveMessage transaction from the latest Ethereum block rather than a gas price API. Large proofs need
  // millions of gas, and the node rejects a transaction unless the account can cover gas limit * maxFeePerGas upfront,
  // so maxFeePerGas must track the prevailing base fee instead of a fixed fallback.
  async _getGasFees(): Promise<{ maxFeePerGas: string; maxPriorityFeePerGas: string }> {
    const { toBN } = this.web3.utils;
    const { baseFeePerGas } = await this.web3.eth.getBlock("latest");
    if (baseFeePerGas === undefined) throw new Error("Latest Ethereum block has no baseFeePerGas");
    const maxPriorityFeePerGas = toBN(MAX_PRIORITY_FEE_PER_GAS_WEI);
    // Adding the priority fee keeps maxFeePerGas >= maxPriorityFeePerGas even when the base fee is near zero.
    const maxFeePerGas = toBN(baseFeePerGas).muln(BASE_FEE_MULTIPLIER).add(maxPriorityFeePerGas);
    return { maxFeePerGas: maxFeePerGas.toString(), maxPriorityFeePerGas: maxPriorityFeePerGas.toString() };
  }
}
module.exports = { Relayer };
