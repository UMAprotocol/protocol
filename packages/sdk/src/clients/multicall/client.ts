import { EthersContracts } from "@uma/core";
import type { SignerOrProvider } from "../..";

export type Instance = EthersContracts.Multicall2;
const Factory = EthersContracts.Multicall2__factory;

export function connect(address: string, provider: SignerOrProvider): Instance {
  return Factory.connect(address, provider);
}
