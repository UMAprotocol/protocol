import assert from "assert";
import { Registry__factory, Registry } from "@uma/core/contract-types/ethers";
import RegistryArtifacts from "@uma/core/build/contracts/Registry.json";
import type { SignerOrProvider, GetEventType } from "../../index.d";
import { Event } from "ethers";

type NewContractRegistered = GetEventType<Registry["filters"]["NewContractRegistered"]>;

export interface EventState {
  contracts?: { [key: string]: NewContractRegistered };
}

type Network = keyof typeof RegistryArtifacts.networks;

export function getAddress(network: Network) {
  const address = RegistryArtifacts?.networks?.[network]?.address;
  assert(address, "no address found for network: " + network);
  return address;
}

export function connect(address: string, provider: SignerOrProvider) {
  return Registry__factory.connect(address, provider);
}

// experimenting with a generalized way of handling events and returning state, inspired from react style reducers
export function reduceEvents(state: EventState = {}, event: Event, index?: number): EventState {
  switch (event.event) {
    // event NewContractRegistered(address indexed contractAddress, address indexed creator, address[] parties);
    case "NewContractRegistered": {
      // this TypedEventFilter was copied from the typechain file. Dont know a better way to get this.
      const typedEvent = event as NewContractRegistered;
      const contracts = state?.contracts || {};
      assert(event.args, `event ${event.event} missing args`);
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
export function getEventState(events: Event[]) {
  return events.reduce(reduceEvents, {});
}
