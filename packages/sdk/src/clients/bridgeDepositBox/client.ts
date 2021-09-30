import { BridgeDepositBoxEthers, BridgeDepositBoxEthers__factory } from "@uma/contracts-node";
import type { SignerOrProvider, GetEventType } from "../..";
import { Event, BigNumber } from "ethers";

export type Instance = BridgeDepositBoxEthers;
const Factory = BridgeDepositBoxEthers__factory;

export function connect(address: string, provider: SignerOrProvider): Instance {
  return Factory.connect(address, provider);
}

export type SetMinimumBridgingDelay = GetEventType<Instance, "SetMinimumBridgingDelay">;
export type WhitelistToken = GetEventType<Instance, "WhitelistToken">;
export type DepositsEnabled = GetEventType<Instance, "DepositsEnabled">;
export type FundsDeposited = GetEventType<Instance, "FundsDeposited">;
export type TokensBridged = GetEventType<Instance, "TokensBridged">;

export type Deposit = {
  chainId: BigNumber;
  depositId: BigNumber;
  l1Recipient: string;
  l2Sender: string;
  l1Token: string;
  amount: BigNumber;
  slowRelayFeePct: BigNumber;
  instantRelayFeePct: BigNumber;
  quoteTimestamp: BigNumber;
};
export type Whitelist = {
  l1Token: string;
  l2Token: string;
  lastBridgeTime: BigNumber;
  bridgePool: string;
};
export interface EventState {
  minimumBridgingDelay?: string;
  whitelistedTokens?: Record<string, Whitelist>;
  depositsEnabled?: Record<string, boolean>;
  deposits?: Record<string, Deposit>;
}

export function reduceEvents(state: EventState, event: Event): EventState {
  switch (event.event) {
    case "SetMinimumBridgingDelay": {
      const typedEvent = event as SetMinimumBridgingDelay;
      const { newMinimumBridgingDelay } = typedEvent.args;
      return {
        ...state,
        minimumBridgingDelay: newMinimumBridgingDelay.toString(),
      };
    }
    case "WhitelistToken": {
      const typedEvent = event as WhitelistToken;
      const { l1Token, l2Token, lastBridgeTime, bridgePool } = typedEvent.args;
      return {
        ...state,
        whitelistedTokens: {
          ...state.whitelistedTokens,
          [l2Token]: { l1Token, l2Token, lastBridgeTime, bridgePool },
        },
      };
    }
    case "DepositsEnabled": {
      const typedEvent = event as DepositsEnabled;
      const { l2Token, depositsEnabled } = typedEvent.args;
      return {
        ...state,
        depositsEnabled: {
          ...state.depositsEnabled,
          [l2Token]: depositsEnabled,
        },
      };
    }
    case "FundsDeposited": {
      const typedEvent = event as FundsDeposited;
      const {
        chainId,
        depositId,
        l1Recipient,
        l2Sender,
        l1Token,
        amount,
        slowRelayFeePct,
        instantRelayFeePct,
        quoteTimestamp,
      } = typedEvent.args;

      return {
        ...state,
        deposits: {
          ...state.deposits,
          [depositId.toString()]: {
            chainId,
            depositId,
            l1Recipient,
            l2Sender,
            l1Token,
            amount,
            slowRelayFeePct,
            instantRelayFeePct,
            quoteTimestamp,
          },
        },
      };
    }
  }
  return state;
}
export function getEventState(events: Event[], eventState: EventState = {}): EventState {
  return events.reduce(reduceEvents, eventState);
}
