export * as clients from "./clients";
export * as stores from "./stores";
export * as tables from "./tables";
export * as utils from "./utils";

// types
import type { TypedEventFilter, TypedEvent } from "@uma/core/contract-types/ethers/commons";

import { Signer } from "@ethersproject/abstract-signer";
import { Provider } from "@ethersproject/abstract-provider";
export type SignerOrProvider = Signer | Provider;

export interface MakeId<I, D> {
  (d: D): I;
}
export interface MaybeId<I> {
  id?: I;
}
export interface HasId<I> {
  id: I;
}

export type GetEventType<ContractType, EventName> = ReturnType<
  ContractType["filters"][EventName]
> extends TypedEventFilter<infer T, infer S>
  ? TypedEvent<T & S>
  : never;
