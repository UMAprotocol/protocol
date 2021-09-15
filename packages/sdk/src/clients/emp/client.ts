import { ExpiringMultiPartyEthers, ExpiringMultiPartyEthers__factory } from "@uma/contracts-node";
import type { SignerOrProvider, GetEventType } from "../..";
import { Event } from "ethers";
import { Balances } from "../../utils";

export type Instance = ExpiringMultiPartyEthers;
const Factory = ExpiringMultiPartyEthers__factory;

export function connect(address: string, provider: SignerOrProvider): Instance {
  return Factory.connect(address, provider);
}

export interface EventState {
  // any address that created a position, regardless of if they have closed it
  sponsors?: string[];
  tokens?: Balances;
  collateral?: Balances;
  expired?: boolean;
}

export type RequestTransferPositionExecuted = GetEventType<Instance, "RequestTransferPositionExecuted">;
export type PositionCreated = GetEventType<Instance, "PositionCreated">;
export type NewSponsor = GetEventType<Instance, "NewSponsor">;
export type SettleExpiredPosition = GetEventType<Instance, "SettleExpiredPosition">;
export type Redeem = GetEventType<Instance, "Redeem">;
export type Withdrawal = GetEventType<Instance, "Withdrawal">;
export type LiquidationCreated = GetEventType<Instance, "LiquidationCreated">;

// experimenting with a generalized way of handling events and returning state, inspired from react style reducers
export function reduceEvents(state: EventState = {}, event: Event): EventState {
  switch (event.event) {
    case "RequestTransferPositionExecuted": {
      const typedEvent = event as RequestTransferPositionExecuted;
      const { oldSponsor, newSponsor } = typedEvent.args;
      const tokens = Balances(state.tokens || {});
      const collateral = Balances(state.collateral || {});
      const collateralBalance = collateral.get(oldSponsor);
      collateral.set(oldSponsor, "0");
      collateral.set(newSponsor, collateralBalance);
      const tokenBalance = tokens.get(oldSponsor);
      tokens.set(oldSponsor, "0");
      tokens.set(newSponsor, tokenBalance.toString());
      return {
        ...state,
        collateral: collateral.balances,
        tokens: tokens.balances,
      };
    }
    case "PositionCreated": {
      const typedEvent = event as PositionCreated;
      const { sponsor, collateralAmount, tokenAmount } = typedEvent.args;
      const tokens = Balances(state.tokens || {});
      const collateral = Balances(state.collateral || {});
      collateral.add(sponsor, collateralAmount.toString());
      tokens.add(sponsor, tokenAmount.toString());
      return {
        ...state,
        collateral: collateral.balances,
        tokens: tokens.balances,
      };
    }
    case "NewSponsor": {
      const typedEvent = event as NewSponsor;
      const { sponsor } = typedEvent.args;
      const sponsors = new Set(state.sponsors || []);
      sponsors.add(sponsor);
      return {
        ...state,
        sponsors: Array.from(sponsors.values()),
      };
    }
    case "SettleExpiredPosition": {
      const typedEvent = event as SettleExpiredPosition;
      const { caller, collateralReturned, tokensBurned } = typedEvent.args;
      const tokens = Balances(state.tokens || {});
      const collateral = Balances(state.collateral || {});
      collateral.sub(caller, collateralReturned.toString());
      tokens.sub(caller, tokensBurned.toString());
      return {
        ...state,
        expired: true,
        collateral: collateral.balances,
        tokens: tokens.balances,
      };
    }
    case "Redeem": {
      const typedEvent = event as Redeem;
      const { sponsor, collateralAmount, tokenAmount } = typedEvent.args;
      const tokens = Balances(state.tokens || {});
      const collateral = Balances(state.collateral || {});
      collateral.sub(sponsor, collateralAmount.toString());
      tokens.sub(sponsor, tokenAmount.toString());
      return {
        ...state,
        collateral: collateral.balances,
        tokens: tokens.balances,
      };
    }
    case "LiquidationCreated": {
      const typedEvent = event as LiquidationCreated;
      const { sponsor, tokensOutstanding, liquidatedCollateral } = typedEvent.args;
      const tokens = Balances(state.tokens || {});
      const collateral = Balances(state.collateral || {});
      collateral.sub(sponsor, liquidatedCollateral.toString());
      tokens.sub(sponsor, tokensOutstanding.toString());
      return {
        ...state,
        collateral: collateral.balances,
        tokens: tokens.balances,
      };
    }
    // these 2 are the same
    case "Withdrawal":
    case "RequestWithdrawalExecuted": {
      const typedEvent = event as Withdrawal;
      const { sponsor, collateralAmount } = typedEvent.args;
      const collateral = Balances(state.collateral || {});
      collateral.sub(sponsor, collateralAmount.toString());
      return {
        ...state,
        collateral: collateral.balances,
      };
    }
    case "ContractExpired": {
      return {
        ...state,
        expired: true,
      };
    }
  }
  return state;
}

export function getEventState(events: Event[], initialState: EventState = {}): EventState {
  return events.reduce(reduceEvents, initialState);
}
