import type { AbiItem, toBN } from "web3-utils";

export type Abi = AbiItem | AbiItem[];

export type BN = ReturnType<typeof toBN>;

export type Awaited<T> = T extends PromiseLike<infer U> ? Awaited<U> : T;

export type FinancialContractType = "ExpiringMultiParty" | "Perpetual";
export type FinancialContractFactoryType = "PerpetualCreator" | "ExpiringMultiPartyCreator";

export function isDefined<T>(val: T | undefined | null): val is T {
  return val !== undefined && val !== null;
}
