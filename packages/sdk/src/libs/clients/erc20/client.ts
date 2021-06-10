import { ERC20__factory, ERC20 } from "@uma/core/contract-types/ethers";
import type { SignerOrProvider, GetEventType } from "../..";
import { Event } from "ethers";
import { Balances } from "../../utils";
import { set } from "lodash";

export type Instance = ERC20;

export function connect(address: string, provider: SignerOrProvider): Instance {
  return ERC20__factory.connect(address, provider);
}

export interface EventState {
  // any address that created a position, regardless of if they have closed it
  balances?: Balances;
  // approvals are keyed both ways here for ease of lookup by either owner or spender
  approvalsByOwner?: {
    [owner: string]: {
      [spender: string]: {
        amount: string;
      };
    };
  };
  approvalsBySpender?: {
    [spender: string]: {
      [owner: string]: {
        amount: string;
      };
    };
  };
}

export type Transfer = GetEventType<Instance, "Transfer">;
export type Approval = GetEventType<Instance, "Approval">;

// experimenting with a generalized way of handling events and returning state, inspired from react style reducers
export function reduceEvents(state: EventState = {}, event: Event, index?: number): EventState {
  switch (event.event) {
    case "Transfer": {
      const typedEvent = event as Transfer;
      const { from, to, value } = typedEvent.args;
      const balances = Balances(state.balances || {});
      balances.sub(from, value);
      balances.add(to, value);
      return {
        ...state,
        balances: balances.balances,
      };
    }
    case "Approval": {
      const typedEvent = event as Approval;
      const { owner, spender, value } = typedEvent.args;
      set(state, ["approvalsByOwner", owner, spender], value.toString());
      set(state, ["approvalsBySpender", spender, owner], value.toString());
      return {
        ...state,
      };
    }
  }
  return state;
}

export function getEventState(events: Event[], initialState: EventState = {}): EventState {
  return events.reduce(reduceEvents, initialState);
}
