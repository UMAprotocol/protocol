export * as clients from "./clients";
export * as stores from "./stores";
export * as tables from "./tables";
export * as utils from "./utils";
export { default as Coingecko } from "./coingecko";
export { default as Multicall } from "./multicall";

// types
import type { TypedEventFilter, TypedEvent } from "@uma/core/types/contract-types/ethers/commons";
import { Contract } from "ethers";
import { Result } from "@ethersproject/abi";
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

export interface Callable {
  (...args: any[]): any;
}
// this convoluted type is meant to cast events to the types you need based on the contract and event name
// example: type NewContractRegistered = GetEventType<Registry,"NewContractRegistered">;
export type GetEventType<ContractType extends Contract, EventName extends string> = ReturnType<
  ContractType["filters"][EventName] extends Callable ? ContractType["filters"][EventName] : never
> extends TypedEventFilter<infer T, infer S>
  ? TypedEvent<T & S extends Result ? T & S : never>
  : never;
// comment for CI
