import winston from "winston";
import { ZERO_ADDRESS } from "@uma/common";

import { providers, VoidSigner } from "ethers";
import { Bridge, OutgoingMessageState } from "arb-ts";

import { Outbox__factory } from "arb-ts/dist/lib/abi/factories/Outbox__factory";

import BridgeAdapterInterface from "./BridgeAdapterInterface";

import Web3 from "web3";
import type { TransactionType } from "@uma/common";

export class ArbitrumBridgeAdapter implements BridgeAdapterInterface {
  public bridge: Bridge | undefined = undefined;

  constructor(readonly logger: winston.Logger, readonly l1Web3: Web3, readonly l2Web3: Web3) {}

  async initialize() {
    const l1EthersProvider = new providers.Web3Provider(this.l1Web3.currentProvider as any);
    const l1EthersVoidSigner = new VoidSigner(ZERO_ADDRESS, l1EthersProvider);
    const l2EthersProvider = new providers.Web3Provider(this.l2Web3.currentProvider as any);
    const l2EthersVoidSigner = new VoidSigner(ZERO_ADDRESS, l2EthersProvider);

    this.bridge = await Bridge.init(l1EthersVoidSigner, l2EthersVoidSigner);

    this.logger.debug({ at: "ArbitrumBridgeAdapter", message: "Initialized Arbitrum Bridge Adapter" });
  }
  async constructCrossDomainFinalizationTransaction(
    l2TransactionHash: string
  ): Promise<{ l2TransactionHash: string; finalizationTransaction: TransactionType | null }> {
    if (!this.bridge) throw new Error("Bridge is not initialized");
    // First, find the Arbitrum txn from the l2TransactionHash hash provided.
    const initiatingTxnReceipt = await this.bridge.l2Provider.getTransactionReceipt(l2TransactionHash);

    // In order to trigger the outbox message, we'll first need the outgoing messages batch number and index; together
    // these two things uniquely identify an outgoing message. To get this data, use getWithdrawalsInL2Transaction,
    // which retrieves this data from the L2 events logs.
    const outGoingMessagesFromTxn = await this.bridge.getWithdrawalsInL2Transaction(initiatingTxnReceipt);

    // Note that in principle, a single transaction could trigger any number of outgoing messages; However, the bridge
    // deposit box used in across is designed to only send one at a time.
    if (outGoingMessagesFromTxn.length !== 1) {
      const error = new Error(`No (or wrong number) of outgoing messages found in transaction:${l2TransactionHash}`);
      this.logger.error({
        at: "ArbitrumBridgeAdapter",
        message: "Bad Arbitrum L2 Transaction included 🤢!",
        l2TransactionHash,
        error,
      });
      throw error;
    }
    const { batchNumber, indexInBatch } = outGoingMessagesFromTxn[0];

    // Check the status of the batchNumber and IndexInBatch to see if the transaction is confirmed. This needs to be
    // true before the transaction can be finalized on L1.
    const outgoingMessageState = await this.bridge.getOutGoingMessageState(batchNumber, indexInBatch);

    if (outgoingMessageState !== OutgoingMessageState.CONFIRMED) {
      this.logger.debug({ at: "ArbitrumBridgeAdapter", message: `${l2TransactionHash} is not confirmed` });
      return { l2TransactionHash, finalizationTransaction: null };
    }

    // If we get to this point, the L2->L1 transaction is confirmed and the relay action can be finalized. The next
    // step is to construct the finalization transaction to return to the cross domain finalizer. This involves
    // building a proof object and sending the transaction to the L1 outbox contract.
    const [proof, outboxAddress] = await Promise.all([
      this.bridge.tryGetProofOnce(batchNumber, indexInBatch),
      this.bridge.getOutboxAddressByBatchNum(batchNumber),
    ]);
    if (proof === null) {
      const error = new Error(
        `Proof object is null for batchNumber: ${batchNumber.toNumber()} indexInBatch: ${indexInBatch.toNumber()} on ${l2TransactionHash}`
      );
      this.logger.error({
        at: "ArbitrumBridgeAdapter",
        message: "Bad Arbitrum Proof generation 🤮!",
        l2TransactionHash,
        error,
      });
      throw error;
    }

    const outboxProofData = { ...proof, batchNumber };

    const outBox = new this.l1Web3.eth.Contract(Outbox__factory.abi as any, outboxAddress);

    this.logger.debug({
      at: "ArbitrumBridgeAdapter",
      message: `Constructing cross domain finalization transaction for ${l2TransactionHash}`,
      batchNumber: batchNumber.toNumber(),
      indexInBatch: indexInBatch.toNumber(),
      l2TransactionHash,
      // outboxProofData, // todo: improve the quality of this log by converting the bns to strings.
    });

    return {
      l2TransactionHash,
      finalizationTransaction: outBox.methods.executeTransaction(
        outboxProofData.batchNumber,
        outboxProofData.proof,
        outboxProofData.path,
        outboxProofData.l2Sender,
        outboxProofData.l1Dest,
        outboxProofData.l2Block,
        outboxProofData.l1Block,
        outboxProofData.timestamp,
        outboxProofData.amount,
        outboxProofData.calldataForL1
      ),
    };
  }
}
