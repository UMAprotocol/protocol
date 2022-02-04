import type { Event } from "ethers";
export type { Signer, BigNumber, BigNumberish, Contract } from "ethers";
export type { Overrides } from "@ethersproject/contracts";
export { Provider, JsonRpcSigner, JsonRpcProvider, Web3Provider, FallbackProvider } from "@ethersproject/providers";
export { TransactionRequest, TransactionReceipt, TransactionResponse } from "@ethersproject/abstract-provider";
export { LogDescription } from "@ethersproject/abi";
export type { Event };

// taken from ethers code https://github.com/ethers-io/ethers.js/blob/master/packages/abi/src.ts/interface.ts#L654
export type Log = { topics: Array<string>; data: string };
