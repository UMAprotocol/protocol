export * as clients from "./clients";
export * as stores from "./stores";
export * as tables from "./tables";
export * as utils from "./utils";
export * as across from "./across";
export * as oracle from "./oracle";
export { default as Coingecko } from "./coingecko";
export { default as Multicall } from "./multicall";
export { default as Multicall2 } from "./multicall2";
export { default as BlockFinder } from "./blockFinder";

// types
import type { TypedEventFilterEthers as TypedEventFilter, TypedEventEthers as TypedEvent } from "@uma/contracts-node";
import { Contract, ethers, providers, Event } from "ethers";
import { Provider } from "@ethersproject/providers";
import { Signer } from "@ethersproject/abstract-signer";

type Result = ethers.utils.Result;

export type SignerOrProvider =
  | providers.Provider
  | providers.BaseProvider
  | Signer
  | Provider
  | providers.JsonRpcProvider
  | ethers.Signer;

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
// TODO: the any below is a hacky solution because some typechain types fail to resolve due to
// incompatible TypedEventFilter and TypedEvent types. This will be fixed by upgrading typechain
// to a version where Ethers events are exported as first class types.
export type GetEventType<ContractType extends Contract, EventName extends string> = ReturnType<
  ContractType["filters"][EventName] extends Callable ? ContractType["filters"][EventName] : never
> extends TypedEventFilter<infer T, infer S>
  ? TypedEvent<T & S extends Result ? T & S : any>
  : never;
