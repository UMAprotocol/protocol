import { MulticallEthers, MulticallEthers__factory } from "@uma/contracts-node";
import type { SignerOrProvider } from "../..";

export type Instance = MulticallEthers;
const Factory = MulticallEthers__factory;

export function connect(address: string, provider: SignerOrProvider): Instance {
  return Factory.connect(address, provider);
}
