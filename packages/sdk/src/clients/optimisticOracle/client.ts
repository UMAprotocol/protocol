import { OptimisticOracleEthers, OptimisticOracleEthers__factory } from "@uma/contracts-node";
import type { SignerOrProvider, GetEventType } from "../..";
import { Event, BigNumberish } from "ethers";

export type Instance = OptimisticOracleEthers;
const Factory = OptimisticOracleEthers__factory;

export function connect(address: string, provider: SignerOrProvider): Instance {
  return Factory.connect(address, provider);
}

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

export type RequestKey = {
  requester: string;
  identifier: string;
  timestamp: number;
  ancillaryData: string;
};
export type Request = RequestKey & {
  proposer: string;
  disputer: string;
  currency: string;
  settled: boolean;
  refundOnDispute: boolean;
  proposedPrice: string;
  resolvedPrice: string;
  expirationTime: string;
  reward: string;
  finalFee: string;
  bond: string;
  customLiveness: string;
  price: string;
  payout: string;
  state: RequestState;
};

export interface EventState {
  requests?: Record<string, Request>;
}

export function requestId(request: Omit<RequestKey, "timestamp"> & { timestamp: BigNumberish }): string {
  return [request.requester, request.identifier, request.timestamp.toString(), request.ancillaryData].join("!");
}

export function reduceEvents(state: EventState, event: Event): EventState {
  switch (event.event) {
    case "RequestPrice": {
      const typedEvent = event as RequestPrice;
      const { requester, identifier, timestamp, ancillaryData, currency, reward, finalFee } = typedEvent.args;
      const id = requestId(typedEvent.args);
      if (!state.requests) state.requests = {};
      const request = state.requests[id] || { requester, identifier, timestamp: timestamp.toNumber(), ancillaryData };
      state.requests[id] = {
        ...request,
        currency,
        reward: reward.toString(),
        finalFee: finalFee.toString(),
        state: RequestState.Requested,
      };
      break;
    }
    case "ProposePrice": {
      const typedEvent = event as ProposePrice;
      const {
        requester,
        identifier,
        timestamp,
        ancillaryData,
        proposer,
        proposedPrice,
        expirationTimestamp,
        currency,
      } = typedEvent.args;
      const id = requestId(typedEvent.args);
      if (!state.requests) state.requests = {};
      const request = state.requests[id] || { requester, identifier, timestamp: timestamp.toNumber(), ancillaryData };
      state.requests[id] = {
        ...request,
        currency,
        proposer,
        proposedPrice: proposedPrice.toString(),
        expirationTime: expirationTimestamp.toString(),
        state: RequestState.Proposed,
      };
      break;
    }
    case "DisputePrice": {
      const typedEvent = event as DisputePrice;
      const { requester, identifier, timestamp, ancillaryData, proposer, disputer, proposedPrice } = typedEvent.args;
      const id = requestId(typedEvent.args);
      if (!state.requests) state.requests = {};
      const request = state.requests[id] || { requester, identifier, timestamp: timestamp.toNumber(), ancillaryData };
      state.requests[id] = {
        ...request,
        proposer,
        disputer,
        proposedPrice: proposedPrice.toString(),
        state: RequestState.Disputed,
      };
      break;
    }
    case "Settle": {
      const typedEvent = event as Settle;
      const { requester, identifier, timestamp, ancillaryData, proposer, disputer, price, payout } = typedEvent.args;
      const id = requestId(typedEvent.args);
      if (!state.requests) state.requests = {};
      const request = state.requests[id] || { requester, identifier, timestamp: timestamp.toNumber(), ancillaryData };
      state.requests[id] = {
        ...request,
        requester,
        proposer,
        disputer,
        price: price.toString(),
        payout: payout.toString(),
        state: RequestState.Settled,
      };
      break;
    }
  }
  return state;
}
export function getEventState(events: Event[], eventState: EventState = {}): EventState {
  return events.reduce(reduceEvents, eventState);
}
