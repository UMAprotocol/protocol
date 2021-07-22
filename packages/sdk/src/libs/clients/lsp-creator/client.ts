import assert from "assert";
import { EthersContracts } from "@uma/core";
import Artifacts from "@uma/core/build/contracts/LongShortPairCreator.json";
import type { SignerOrProvider, GetEventType } from "../..";
import { Event } from "ethers";

// exporting Registry type in case its needed
export type Instance = EthersContracts.LongShortPairCreator;
const Factory = EthersContracts.LongShortPairCreator__factory;

export type Network = keyof typeof Artifacts.networks;

export function getAddress(network: Network): string {
  const address = Artifacts?.networks?.[network]?.address;
  assert(address, "no address found for network: " + network);
  return address;
}

export function getAbi() {
  return Artifacts?.abi;
}

export function connect(address: string, provider: SignerOrProvider): Instance {
  return Factory.connect(address, provider);
}

export type CreatedLongShortPair = GetEventType<Instance, "CreatedLongShortPair">;

export interface EventState {
  contracts?: {
    [lspAddress: string]: CreatedLongShortPair["args"];
  };
}

export function reduceEvents(state: EventState, event: Event, index?: number): EventState {
  switch (event.event) {
    case "CreatedLongShortPair": {
      const typedEvent = event as CreatedLongShortPair;
      const contracts = state?.contracts || {};
      return {
        ...state,
        contracts: {
          ...contracts,
          [typedEvent.args.longShortPair]: typedEvent.args,
        },
      };
    }
  }
  return state;
}
export function getEventState(events: Event[], eventState: EventState = {}): EventState {
  return events.reduce(reduceEvents, eventState);
}
