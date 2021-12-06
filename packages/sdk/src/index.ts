export * as clients from "./clients";
export * as stores from "./stores";
export * as tables from "./tables";
export * as utils from "./utils";
export * as across from "./across";
export { default as Coingecko } from "./coingecko";
export { default as Multicall } from "./multicall";
export { default as Multicall2 } from "./multicall2";
export { default as BlockFinder } from "./blockFinder";

// types
import type { TypedEventFilterEthers as TypedEventFilter, TypedEventEthers as TypedEvent } from "@uma/contracts-node";
import { Contract, ethers, Signer, providers, Event } from "ethers";
import { Provider } from "@ethersproject/providers";

type Result = ethers.utils.Result;

export type SignerOrProvider = providers.BaseProvider | Signer | Provider;

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

export type SerializableEvent = Omit<
  Event,
  "decode" | "removeListener" | "getBlock" | "getTransaction" | "getTransactionReceipt"
>;

// this convoluted type is meant to cast events to the types you need based on the contract and event name
// example: type NewContractRegistered = GetEventType<Registry,"NewContractRegistered">;
export type GetEventType<ContractType extends Contract, EventName extends string> = ReturnType<
  ContractType["filters"][EventName] extends Callable ? ContractType["filters"][EventName] : never
> extends TypedEventFilter<infer T, infer S>
  ? TypedEvent<T & S extends Result ? T & S : never>
  : never;
