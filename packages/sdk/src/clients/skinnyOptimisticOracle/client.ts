import {
  SkinnyOptimisticOracleEthers,
  SkinnyOptimisticOracleEthers__factory,
  getSkinnyOptimisticOracleAbi,
} from "@uma/contracts-node";
import type { SignerOrProvider, GetEventType } from "../..";
import { Event, BigNumberish, utils, BigNumber } from "ethers";

export type Instance = SkinnyOptimisticOracleEthers;
const Factory = SkinnyOptimisticOracleEthers__factory;

export function connect(address: string, provider: SignerOrProvider): Instance {
  return Factory.connect(address, provider);
}

export const contractInterface = new utils.Interface(getSkinnyOptimisticOracleAbi());

export type RequestPrice = GetEventType<Instance, "RequestPrice">;
export type ProposePrice = GetEventType<Instance, "ProposePrice">;
export type DisputePrice = GetEventType<Instance, "DisputePrice">;
export type Settle = GetEventType<Instance, "Settle">;

export enum RequestState {
  Invalid = 0, // Never requested.
  Requested, // Requested, no other actions taken.
  Proposed, // Proposed, but not expired or disputed yet.
  Expired, // Proposed, not disputed, past liveness.
  Disputed, // Disputed, but no DVM price returned yet.
  Resolved, // Disputed and DVM price is available.
  Settled, // Final price has been set in the contract (can get here from Expired or Resolved).
}

export interface SolidityRequest {
  proposer: string; // Address of the proposer.
  disputer: string; // Address of the disputer.
  currency: string; // ERC20 token used to pay rewards and fees.
  settled: boolean; // True if the request is settled.
  proposedPrice: BigNumber; // Price that the proposer submitted.
  resolvedPrice: BigNumber; // Price resolved once the request is settled.
  expirationTime: BigNumber; // Time at which the request auto-settles without a dispute.
  reward: BigNumber; // Amount of the currency to pay to the proposer on settlement.
  finalFee: BigNumber; // Final fee to pay to the Store upon request to the DVM.
  bond: BigNumber; // Bond that the proposer and disputer must pay on top of the final fee.
  customLiveness: BigNumber; // Custom liveness value set by the requester.
}

// all events have these values
export type RequestKey = {
  requester: string;
  identifier: string;
  timestamp: number;
  ancillaryData: string;
};
export type Request = RequestKey &
  SolidityRequest &
  // this is partial since we dont know what events we have to populate parts of this
  Partial<{
    refundOnDispute: boolean;
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
  }>;

export interface EventState {
  requests?: Record<string, Request>;
}

export function requestId(request: Omit<RequestKey, "timestamp"> & { timestamp: BigNumberish }): string {
  // if enabling sorting, put timestamp first
  return [request.timestamp.toString(), request.identifier, request.requester, request.ancillaryData].join("!");
}
export function reduceEvents(state: EventState, event: Event): EventState {
  switch (event.event) {
    case "RequestPrice": {
      const typedEvent = event as RequestPrice;
      const { requester, identifier, timestamp, ancillaryData, request } = typedEvent.args;
      const id = requestId(typedEvent.args);
      if (!state.requests) state.requests = {};
      state.requests[id] = {
        // need to maintain previous state in case it exists
        ...state.requests[id],
        ...request,
        requester,
        identifier,
        timestamp,
        ancillaryData,
        state: RequestState.Requested,
        requestTx: event.transactionHash,
        requestBlockNumber: event.blockNumber,
        requestLogIndex: event.logIndex,
      };
      break;
    }
    case "ProposePrice": {
      const typedEvent = event as ProposePrice;
      const { requester, identifier, timestamp, ancillaryData, request } = typedEvent.args;
      const id = requestId(typedEvent.args);
      if (!state.requests) state.requests = {};
      state.requests[id] = {
        ...state.requests[id],
        ...request,
        requester,
        identifier,
        timestamp,
        ancillaryData,
        state: RequestState.Proposed,
        proposeTx: event.transactionHash,
        proposeBlockNumber: event.blockNumber,
        proposeLogIndex: event.logIndex,
      };
      break;
    }
    case "DisputePrice": {
      const typedEvent = event as DisputePrice;
      const { requester, identifier, timestamp, ancillaryData, request } = typedEvent.args;
      const id = requestId(typedEvent.args);
      if (!state.requests) state.requests = {};
      state.requests[id] = {
        ...state.requests[id],
        ...request,
        requester,
        identifier,
        timestamp,
        ancillaryData,
        state: RequestState.Disputed,
        disputeTx: event.transactionHash,
        disputeBlockNumber: event.blockNumber,
        disputeLogIndex: event.logIndex,
      };
      break;
    }
    case "Settle": {
      const typedEvent = event as Settle;
      const { requester, identifier, timestamp, ancillaryData, request } = typedEvent.args;
      const id = requestId(typedEvent.args);
      if (!state.requests) state.requests = {};
      state.requests[id] = {
        ...state.requests[id],
        ...request,
        requester,
        identifier,
        timestamp,
        ancillaryData,
        state: RequestState.Settled,
        settleTx: event.transactionHash,
        settleBlockNumber: event.blockNumber,
        settleLogIndex: event.logIndex,
      };
      break;
    }
  }
  return state;
}
export function getEventState(events: Event[], eventState: EventState = {}): EventState {
  return events.reduce(reduceEvents, eventState);
}
