import { BigNumber, BigNumberish } from "@ethersproject/bignumber";
import { BytesLike } from "@ethersproject/bytes";
import { TypedEvent } from "@uma/contracts-node/typechain/core/ethers/common";

export interface AdminProposalTransaction {
  to: string;
  value: BigNumberish;
  data: BytesLike;
}

export interface ProposalToExecute {
  proposalNumber: number;
  fromTransactionIndex: number;
  toTransactionIndex: number;
}

export type SentMessageEvent = TypedEvent<
  [string, string, string, BigNumber, BigNumber] & {
    target: string;
    sender: string;
    message: string;
    messageNonce: BigNumber;
    gasLimit: BigNumber;
  }
>;

export type MessageDeliveredEvent = TypedEvent<
  [BigNumber, string, string, number, string, string, BigNumber, BigNumber] & {
    messageIndex: BigNumber;
    beforeInboxAcc: string;
    inbox: string;
    kind: number;
    sender: string;
    messageDataHash: string;
    baseFeeL1: BigNumber;
    timestamp: BigNumber;
  }
>;

export type InboxMessageDeliveredEvent = TypedEvent<
  [BigNumber, string] & {
    messageNum: BigNumber;
    data: string;
  }
>;

export type InboxMessageDeliveredData = [string, BigNumber, BigNumber, BigNumber] & {
  to: string;
  l2CallValue: BigNumber;
  amount: BigNumber;
  maxSubmissionCost: BigNumber;
  excessFeeRefundAddress: string;
  callValueRefundAddress: string;
  gasLimit: BigNumber;
  maxFeePerGas: BigNumber;
  data: string;
};

export type StateSyncedEvent = TypedEvent<
  [BigNumber, string, string] & {
    id: BigNumber;
    contractAddress: string;
    data: string;
  }
>;
