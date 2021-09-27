import {
  LongShortPairCreatorEthers,
  LongShortPairCreatorEthers__factory,
  getLongShortPairCreatorAbi as getAbi,
  getLongShortPairCreatorAddress as getAddress,
} from "@uma/contracts-node";
import type { SignerOrProvider, GetEventType } from "../..";
import { Event } from "ethers";

// exporting Registry type in case its needed
export type Instance = LongShortPairCreatorEthers;
const Factory = LongShortPairCreatorEthers__factory;

export type Network = string | number;

export { getAddress, getAbi };

export function connect(address: string, provider: SignerOrProvider): Instance {
  return Factory.connect(address, provider);
}

export type CreatedLongShortPair = GetEventType<Instance, "CreatedLongShortPair">;

export interface EventState {
  contracts?: {
    [lspAddress: string]: CreatedLongShortPair;
  };
}

export function reduceEvents(state: EventState, event: Event): EventState {
  switch (event.event) {
    case "CreatedLongShortPair": {
      const typedEvent = event as CreatedLongShortPair;
      const contracts = state?.contracts || {};
      return {
        ...state,
        contracts: {
          ...contracts,
          [typedEvent.args.longShortPair]: typedEvent,
        },
      };
    }
  }
  return state;
}
export function getEventState(events: Event[], eventState: EventState = {}): EventState {
  return events.reduce(reduceEvents, eventState);
}
