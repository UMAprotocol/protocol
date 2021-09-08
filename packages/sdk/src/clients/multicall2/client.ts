import { Multicall2Ethers, Multicall2Ethers__factory } from "@uma/contracts-node";
import type { SignerOrProvider } from "../..";

export type Instance = Multicall2Ethers;
const Factory = Multicall2Ethers__factory;

export function connect(address: string, provider: SignerOrProvider): Instance {
  return Factory.connect(address, provider);
}
