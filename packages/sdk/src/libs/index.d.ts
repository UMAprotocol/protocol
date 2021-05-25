import type { TypedEventFilter, TypedEvent } from "@uma/core/contract-types/ethers/commons";

import { Signer } from "@ethersproject/abstract-signer";
import { Provider } from "@ethersproject/abstract-provider";
export type SignerOrProvider = Signer | Provider;

export { Store } from "./stores/index.d";
export { BlockType } from "./tables/blocks/index.d";

export interface MakeId<I, D> {
  (d: D): I;
}
export interface MaybeId<I> {
  id?: I;
}
export interface HasId<I> {
  id: I;
}

// this allows us to infer event types from typechains event filter functions
export interface Callable {
  (...args: any[]): any;
}
export type GetEventType<F> = ReturnType<F extends Callable ? F : never> extends TypedEventFilter<infer T, infer S>
  ? TypedEvent<T & S & Result>
  : never;

export * as Registry from './clients/registry'
