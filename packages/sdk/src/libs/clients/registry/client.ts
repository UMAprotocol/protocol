import assert from "assert";
import { Registry__factory, Registry } from "@uma/core/contract-types/ethers";
import RegistryArtifacts from "@uma/core/build/contracts/Registry.json";
import type { SignerOrProvider, GetEventType } from "../..";
import { Event } from "ethers";

type NewContractRegistered = GetEventType<Registry, "NewContractRegistered">;

export interface EventState {
  contracts?: { [key: string]: NewContractRegistered };
}

export type Network = keyof typeof RegistryArtifacts.networks;

export function getAddress(network: Network): string {
  const address = RegistryArtifacts?.networks?.[network]?.address;
  assert(address, "no address found for network: " + network);
  return address;
}

// exporting Registry type in case its needed
export { Registry as Instance };
export function connect(address: string, provider: SignerOrProvider): Registry {
  return Registry__factory.connect(address, provider);
}

// experimenting with a generalized way of handling events and returning state, inspired from react style reducers
export function reduceEvents(state: EventState = {}, event: Event, index?: number): EventState {
  switch (event.event) {
    case "NewContractRegistered": {
      const typedEvent = event as NewContractRegistered;
      const contracts = state?.contracts || {};
      return {
        ...state,
        contracts: {
          ...contracts,
          [typedEvent.args.contractAddress]: typedEvent,
        },
      };
    }
  }
  return state;
}
export function getEventState(events: Event[]): EventState {
  return events.reduce(reduceEvents, {});
}
