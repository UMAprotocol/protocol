import { EthersContracts } from "@uma/core";
import type { SignerOrProvider } from "../..";

export type Instance = EthersContracts.Multicall;
const Factory = EthersContracts.Multicall__factory;

export function connect(address: string, provider: SignerOrProvider): Instance {
  return Factory.connect(address, provider);
}
