import type { Event } from "ethers";
import type { Interface } from "@ethersproject/abi";

export type { Signer, BigNumber, BigNumberish, Contract } from "ethers";
export type { Overrides } from "@ethersproject/contracts";
export { Provider, JsonRpcSigner, JsonRpcProvider, Web3Provider, FallbackProvider } from "@ethersproject/providers";
export { TransactionRequest, TransactionReceipt, TransactionResponse } from "@ethersproject/abstract-provider";
export type { Log } from "@ethersproject/abstract-provider";
export type { Event, Interface };

export type SerializableEvent = Omit<
  Event,
  "decode" | "removeListener" | "getBlock" | "getTransaction" | "getTransactionReceipt"
>;

// taken from ethers code https://github.com/ethers-io/ethers.js/blob/master/packages/abi/src.ts/interface.ts#L654
export type ParsedLog = ReturnType<Interface["parseLog"]>;
