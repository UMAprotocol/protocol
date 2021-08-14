import type { AbiItem, toBN } from "web3-utils";

export type Abi = AbiItem | AbiItem[];

export type BN = ReturnType<typeof toBN>;

export type Awaited<T> = T extends PromiseLike<infer U> ? Awaited<U> : T;
