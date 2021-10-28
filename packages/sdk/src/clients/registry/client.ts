import {
  RegistryEthers,
  RegistryEthers__factory,
  getRegistryAddress as getAbi,
  getRegistryAddress as getAddress,
} from "@uma/contracts-node";

import type { SignerOrProvider, GetEventType } from "../..";
import { Event } from "ethers";

export type Instance = RegistryEthers;
const Factory = RegistryEthers__factory;

export type Network = string | number;

export { getAddress, getAbi };

export function connect(address: string, provider: SignerOrProvider): Instance {
  return Factory.connect(address, provider);
}

export interface EventState {
  contracts?: { [key: string]: NewContractRegistered };
}

export type NewContractRegistered = GetEventType<Instance, "NewContractRegistered">;

// experimenting with a generalized way of handling events and returning state, inspired from react style reducers
export function reduceEvents(state: EventState = {}, event: Event): EventState {
  switch (event.event) {
    case "NewContractRegistered": {
      const typedEvent = event as NewContractRegistered;
      const { contractAddress } = typedEvent.args;
      const contracts = state?.contracts || {};
      return {
        ...state,
        contracts: {
          ...contracts,
          [contractAddress]: typedEvent,
        },
      };
    }
  }
  return state;
}
export function getEventState(events: Event[]): EventState {
  return events.reduce(reduceEvents, {});
}
