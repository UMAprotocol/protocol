import { BridgePoolEthers, BridgePoolEthers__factory, BridgePoolInterfaceEthers } from "@uma/contracts-node";
import type { SignerOrProvider, GetEventType, SerializableEvent } from "../..";
import { BigNumber } from "ethers";
import { Balances } from "../../utils";

export type Instance = BridgePoolEthers;
export const Factory = BridgePoolEthers__factory;
export type Interface = BridgePoolInterfaceEthers;

export function connect(address: string, provider: SignerOrProvider): Instance {
  return Factory.connect(address, provider);
}
export function attach(address: string): Instance {
  return new Factory().attach(address);
}

export type LiquidityAdded = GetEventType<Instance, "LiquidityAdded">;
export type LiquidityRemoved = GetEventType<Instance, "LiquidityRemoved">;
export type DepositRelayed = GetEventType<Instance, "DepositRelayed">;
export type RelaySpedUp = GetEventType<Instance, "RelaySpedUp">;
export type RelayDisputed = GetEventType<Instance, "RelayDisputed">;
export type RelayCanceled = GetEventType<Instance, "RelayCanceled">;
export type RelaySettled = GetEventType<Instance, "RelaySettled">;
export type BridgePoolAdminTransferred = GetEventType<Instance, "BridgePoolAdminTransferred">;

export type DepositData = {
  chainId: BigNumber;
  depositId: BigNumber;
  l1Recipient: string;
  l2Sender: string;
  amount: BigNumber;
  slowRelayFeePct: BigNumber;
  instantRelayFeePct: BigNumber;
  quoteTimestamp: number;
};
export type RelayData = {
  relayState: number;
  slowRelayer: string;
  relayId: number;
  realizedLpFeePct: BigNumber;
  priceRequestTime: number;
  proposerBond: BigNumber;
  finalFee: BigNumber;
};
export interface EventState {
  oldAdmin?: string;
  newAdmin?: string;
  tokens: Balances;
  lpTokens: Balances;
  deposits: Record<string, DepositData>;
  relays: Record<string, RelayData>;
  instantRelays: Record<string, string>;
}

export function eventStateDefaults() {
  return {
    tokens: {},
    lpTokens: {},
    deposits: {},
    relays: {},
    instantRelays: {},
  };
}

export function reduceEvents(state: EventState, event: SerializableEvent): EventState {
  switch (event.event) {
    // event LiquidityAdded(address indexed token, uint256 amount, uint256 lpTokensMinted, address liquidityProvider);
    case "LiquidityAdded": {
      const typedEvent = event as LiquidityAdded;
      const { amount, lpTokensMinted, liquidityProvider } = typedEvent.args;
      const tokens = Balances(state.tokens || {});
      const lpTokens = Balances(state.lpTokens || {});
      tokens.add(liquidityProvider, amount.toString());
      lpTokens.add(liquidityProvider, lpTokensMinted.toString());
      return {
        ...state,
        tokens: {
          ...tokens.balances,
        },
        lpTokens: {
          ...lpTokens.balances,
        },
      };
    }
    // event LiquidityRemoved(address indexed token, uint256 amount, uint256 lpTokensBurnt, address liquidityProvider);
    case "LiquidityRemoved": {
      const typedEvent = event as LiquidityRemoved;
      const { amount, lpTokensBurnt, liquidityProvider } = typedEvent.args;
      const tokens = Balances(state.tokens || {});
      const lpTokens = Balances(state.lpTokens || {});
      tokens.sub(liquidityProvider, amount.toString());
      lpTokens.sub(liquidityProvider, lpTokensBurnt.toString());
      return {
        ...state,
        tokens: {
          ...tokens.balances,
        },
        lpTokens: {
          ...lpTokens.balances,
        },
      };
    }
    // event DepositRelayed( bytes32 indexed depositHash, DepositData depositData, address l1Token, RelayData relay, bytes32 relayAncillaryDataHash);
    case "DepositRelayed": {
      const typedEvent = event as DepositRelayed;
      const { depositHash, depositData, relay, relayAncillaryDataHash } = typedEvent.args;
      return {
        ...state,
        relays: {
          ...state.relays,
          [relayAncillaryDataHash]: relay,
        },
        deposits: {
          ...state.deposits,
          [depositHash]: depositData,
        },
      };
    }
    // event RelaySpedUp(bytes32 indexed depositHash, address indexed instantRelayer, RelayData relay);
    case "RelaySpedUp": {
      const typedEvent = event as RelaySpedUp;
      const { depositHash, instantRelayer } = typedEvent.args;
      return {
        ...state,
        instantRelays: {
          ...(state.instantRelays || {}),
          [depositHash]: instantRelayer,
        },
      };
    }
    // event RelayDisputed(bytes32 indexed depositHash, bytes32 indexed relayHash, address indexed disputer);
    case "RelayDisputed": {
      // TODO: finish implementation
      // const typedEvent = event as RelayDisputed;
      // const { depositHash, relayHash, disputer } = typedEvent.args;
      return state;
    }
    // event RelayCanceled(bytes32 indexed depositHash, bytes32 indexed relayHash, address indexed disputer);
    case "RelayCanceled": {
      // TODO: finish implementation
      // const typedEvent = event as RelayCanceled;
      // const { depositHash, relayHash, disputer } = typedEvent.args;
      return state;
    }
    // event RelaySettled(bytes32 indexed depositHash, address indexed caller, RelayData relay);
    case "RelaySettled": {
      // TODO: finish implementation
      // const typedEvent = event as RelaySettled;
      // const { depositHash, caller, relay } = typedEvent.args;
      return state;
    }
    // event BridgePoolAdminTransferred(address oldAdmin, address newAdmin);
    case "BridgePoolAdminTransferred": {
      const typedEvent = event as BridgePoolAdminTransferred;
      const { oldAdmin, newAdmin } = typedEvent.args;
      return {
        ...state,
        oldAdmin,
        newAdmin,
      };
    }
  }
  return state;
}
export function getEventState(events: SerializableEvent[], eventState: EventState = eventStateDefaults()): EventState {
  return events.reduce(reduceEvents, eventState);
}
