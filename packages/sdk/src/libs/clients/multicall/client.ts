import { Multicall__factory, Multicall } from "@uma/core/contract-types/ethers";
import type { SignerOrProvider } from "../..";

export type Instance = Multicall;

export function connect(address: string, provider: SignerOrProvider): Instance {
  return Multicall__factory.connect(address, provider);
}
