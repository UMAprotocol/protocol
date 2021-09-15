import { LongShortPairEthers, LongShortPairEthers__factory } from "@uma/contracts-node";
import type { SignerOrProvider, GetEventType } from "../..";
import { Event } from "ethers";
import { Balances } from "../../utils";

export type Instance = LongShortPairEthers;
const Factory = LongShortPairEthers__factory;

export function connect(address: string, provider: SignerOrProvider): Instance {
  return Factory.connect(address, provider);
}

export type TokensCreated = GetEventType<Instance, "TokensCreated">;
export type TokensRedeemed = GetEventType<Instance, "TokensRedeemed">;
export type ContractExpired = GetEventType<Instance, "ContractExpired">;
export type PositionSettled = GetEventType<Instance, "PositionSettled">;

export interface EventState {
  sponsors?: string[];
  longs?: Balances;
  shorts?: Balances;
  collateral?: Balances;
  expired?: boolean;
  expiredBy?: string;
}

export function reduceEvents(state: EventState, event: Event): EventState {
  switch (event.event) {
    case "TokensCreated": {
      const typedEvent = event as TokensCreated;
      const { sponsor, collateralUsed, tokensMinted } = typedEvent.args;

      const sponsors = new Set(state.sponsors || []);
      const longs = Balances(state.longs || {});
      const shorts = Balances(state.shorts || {});
      const collateral = Balances(state.collateral || {});

      sponsors.add(sponsor);
      longs.add(sponsor, tokensMinted);
      shorts.add(sponsor, tokensMinted);
      collateral.add(sponsor, collateralUsed);

      return {
        ...state,
        collateral: collateral.balances,
        shorts: shorts.balances,
        longs: longs.balances,
        sponsors: Array.from(sponsors.values()),
      };
    }
    case "TokensRedeemed": {
      const typedEvent = event as TokensRedeemed;
      const { sponsor, collateralReturned, tokensRedeemed } = typedEvent.args;

      const longs = Balances(state.longs || {});
      const shorts = Balances(state.shorts || {});
      const collateral = Balances(state.collateral || {});

      longs.sub(sponsor, tokensRedeemed);
      shorts.sub(sponsor, tokensRedeemed);
      collateral.sub(sponsor, collateralReturned);

      return {
        ...state,
        collateral: collateral.balances,
        shorts: shorts.balances,
        longs: longs.balances,
      };
    }
    case "ContractExpired": {
      const typedEvent = event as ContractExpired;
      const { caller } = typedEvent.args;

      return {
        ...state,
        expired: true,
        expiredBy: caller,
      };
    }
    case "PositionSettled": {
      const typedEvent = event as PositionSettled;
      const { sponsor, collateralReturned, longTokens, shortTokens } = typedEvent.args;

      const longs = Balances(state.longs || {});
      const shorts = Balances(state.shorts || {});
      const collateral = Balances(state.collateral || {});

      longs.sub(sponsor, longTokens);
      shorts.sub(sponsor, shortTokens);
      collateral.sub(sponsor, collateralReturned);

      return {
        ...state,
        collateral: collateral.balances,
        shorts: shorts.balances,
        longs: longs.balances,
      };
    }
  }
  return state;
}
export function getEventState(events: Event[], eventState: EventState = {}): EventState {
  return events.reduce(reduceEvents, eventState);
}
