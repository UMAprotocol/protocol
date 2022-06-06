import {
  SkinnyOptimisticOracleEthers,
  SkinnyOptimisticOracleEthers__factory,
  getSkinnyOptimisticOracleAbi,
} from "@uma/contracts-node";
import type { SignerOrProvider, GetEventType } from "../..";
import { Event, BigNumberish, utils } from "ethers";

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

export type SolidityRequest = {
  proposer: string; // Address of the proposer.
  disputer: string; // Address of the disputer.
  currency: string; // ERC20 token used to pay rewards and fees.
  settled: boolean; // True if the request is settled.
  proposedPrice: BigNumberish; // Price that the proposer submitted.
  resolvedPrice: BigNumberish; // Price resolved once the request is settled.
  expirationTime: BigNumberish; // Time at which the request auto-settles without a dispute.
  reward: BigNumberish; // Amount of the currency to pay to the proposer on settlement.
  finalFee: BigNumberish; // Final fee to pay to the Store upon request to the DVM.
  bond: BigNumberish; // Bond that the proposer and disputer must pay on top of the final fee.
  customLiveness: BigNumberish; // Custom liveness value set by the requester.
};

// all events have these values
export type RequestKey = {
  requester: string;
  identifier: string;
  timestamp: number;
  ancillaryData: string;
};
export type Request = RequestKey &
  // this is partial since we dont know what events we have to populate parts of this
  Partial<{
    proposer: string;
    disputer: string;
    currency: string;
    settled: boolean;
    refundOnDispute: boolean;
    proposedPrice: string;
    resolvedPrice: string;
    expirationTime: number;
    reward: string;
    finalFee: string;
    bond: string;
    customLiveness: string;
    price: string;
    payout: string;
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
  }>;

export interface EventState {
  requests?: Record<string, Request>;
}

export function requestId(request: Omit<RequestKey, "timestamp"> & { timestamp: BigNumberish }): string {
  // if enabling sorting, put timestamp first
  return [request.timestamp.toString(), request.identifier, request.requester, request.ancillaryData].join("!");
}

export function parseRequest(request: SolidityRequest) {
  return {
    ...request,
    proposedPrice: request.proposedPrice.toString(),
    resolvedPrice: request.proposedPrice.toString(),
    expirationTime: Number(request.proposedPrice.toString()),
    reward: request.proposedPrice.toString(),
    finalFee: request.proposedPrice.toString(),
    bond: request.proposedPrice.toString(),
    customLiveness: request.proposedPrice.toString(),
  };
}

export function reduceEvents(state: EventState, event: Event): EventState {
  switch (event.event) {
    case "RequestPrice": {
      const typedEvent = event as RequestPrice;
      const { requester, identifier, timestamp, ancillaryData, request } = typedEvent.args;
      const id = requestId(typedEvent.args);
      if (!state.requests) state.requests = {};
      state.requests[id] = {
        ...parseRequest(request),
        requester,
        identifier,
        timestamp,
        ancillaryData,
        state: RequestState.Requested,
        requestTx: event.transactionHash,
        requestBlockNumber: event.blockNumber,
      };
      break;
    }
    case "ProposePrice": {
      const typedEvent = event as ProposePrice;
      const { requester, identifier, timestamp, ancillaryData, request } = typedEvent.args;
      const id = requestId(typedEvent.args);
      if (!state.requests) state.requests = {};
      state.requests[id] = {
        ...parseRequest(request),
        requester,
        identifier,
        timestamp,
        ancillaryData,
        state: RequestState.Proposed,
        proposeTx: event.transactionHash,
        proposeBlockNumber: event.blockNumber,
      };
      break;
    }
    case "DisputePrice": {
      const typedEvent = event as DisputePrice;
      const { requester, identifier, timestamp, ancillaryData, request } = typedEvent.args;
      const id = requestId(typedEvent.args);
      if (!state.requests) state.requests = {};
      state.requests[id] = {
        ...parseRequest(request),
        requester,
        identifier,
        timestamp,
        ancillaryData,
        state: RequestState.Disputed,
        disputeTx: event.transactionHash,
        disputeBlockNumber: event.blockNumber,
      };
      break;
    }
    case "Settle": {
      const typedEvent = event as Settle;
      const { requester, identifier, timestamp, ancillaryData, request } = typedEvent.args;
      const id = requestId(typedEvent.args);
      if (!state.requests) state.requests = {};
      state.requests[id] = {
        ...parseRequest(request),
        requester,
        identifier,
        timestamp,
        ancillaryData,
        state: RequestState.Settled,
        settleTx: event.transactionHash,
        settleBlockNumber: event.blockNumber,
      };
      break;
    }
  }
  return state;
}
export function getEventState(events: Event[], eventState: EventState = {}): EventState {
  return events.reduce(reduceEvents, eventState);
}
