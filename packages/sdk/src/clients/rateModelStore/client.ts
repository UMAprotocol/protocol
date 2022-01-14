import {
  RateModelStoreEthers,
  RateModelStoreEthers__factory,
  getRateModelStoreAddress as getAddress,
} from "@uma/contracts-node";
import type { SignerOrProvider } from "../..";

export type Instance = RateModelStoreEthers;
export const Factory = RateModelStoreEthers__factory;

export { getAddress };

export function connect(address: string, provider: SignerOrProvider): Instance {
  return Factory.connect(address, provider);
}
export function attach(address: string): Instance {
  return new Factory().attach(address);
}
