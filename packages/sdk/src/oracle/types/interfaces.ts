import {
  BigNumberish,
  BigNumber,
  Signer,
  TransactionResponse,
  TransactionReceipt,
  Provider,
  Log,
  ParsedLog,
} from "../types/ethers";
import { RequestState, RequestKey } from "../../clients/optimisticOracle";
import { Client } from "../client";
import { OracleType } from "../types/state";

// This object diverges from the v1 and v2 request shapes. This is to normalize
// the data into a common shape. This has pitfalls and will be problematic if oracle implementations
// diverge too much, but so far it seems ok
export type Request = RequestKey & {
  chainId: number;
} & Partial<{
    // this is partial since we dont know what events we have to populate parts of this
    proposer: string;
    disputer: string;
    currency: string;
    settled: boolean;
    proposedPrice: BigNumber;
    resolvedPrice: BigNumber;
    expirationTime: BigNumber;
    reward: BigNumber;
    finalFee: BigNumber;
    price: BigNumber;
    payout: BigNumber;
    state: RequestState;
    // metadata about the transaction that triggered the state changes
    requestTx: string;
    proposeTx: string;
    disputeTx: string;
    settleTx: string;
    requestBlockNumber: number;
    proposeBlockNumber: number;
    disputeBlockNumber: number;
    settleBlockNumber: number;
    requestLogIndex: number;
    proposeLogIndex: number;
    disputeLogIndex: number;
    settleLogIndex: number;
    // oo v2 fields moved here from settings object
    bond: BigNumber;
    customLiveness: BigNumber;
    eventBased: boolean; // True if the request is set to be event-based.
    refundOnDispute: boolean; // True if the requester should be refunded their reward on dispute.
    callbackOnPriceProposed: boolean; // True if callbackOnPriceProposed callback is required.
    callbackOnPriceDisputed: boolean; // True if callbackOnPriceDisputed callback is required.
    callbackOnPriceSettled: boolean; // True if callbackOnPriceSettled callback is required.
  }>;

export type Requests = Request[];

export { RequestState, RequestKey };

export interface OracleProps {
  defaultLiveness: BigNumber;
}

export interface NewOracle {
  new (provider: Provider, address: string, chainId: number): OracleInterface;
}

export interface OracleInterface {
  // u se this to query on chain for request data given the key.
  fetchRequest: (props: RequestKey) => Promise<Request>;
  // return cached request info syncronously
  getRequest: (props: RequestKey) => Request;
  disputePrice: (signer: Signer, key: RequestKey) => Promise<TransactionResponse>;
  proposePrice: (signer: Signer, key: RequestKey, price: BigNumberish) => Promise<TransactionResponse>;
  settle: (signer: Signer, key: RequestKey) => Promise<TransactionResponse>;
  update: (startBlock: number, endBlock: number | "latest") => Promise<void>;
  updateFromTransactionReceipt: (receipt: TransactionReceipt) => void;
  getProps: () => Promise<OracleProps>;
  listRequests: () => Requests;
  parseLog: (log: Log) => Log & ParsedLog & { event: string; eventSignature: string };
}

export type ClientTable = {
  [key in OracleType]?: Client;
};
