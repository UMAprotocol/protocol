import assert from "assert";
import { Tenderly, Network } from "@tenderly/sdk";

// a list of chains osnap is enabled on. must be updated manually as we add more
export const ChainsEnabled: Network[] = [
  Network.MAINNET,
  Network.GOERLI,
  Network.SEPOLIA,
  Network.POLYGON,
  Network.OPTIMISTIC,
  Network.ARBITRUM_ONE,
];
type BasicTenderlyConfig = Omit<ConstructorParameters<typeof Tenderly>[0], "network">;

// tenderly instances per chain
export class MultiChainTenderly {
  public tenderlies: Record<string, Tenderly>;
  constructor(public config: BasicTenderlyConfig, public chainsEnabled: Network[] = ChainsEnabled) {
    this.tenderlies = Object.fromEntries(
      chainsEnabled.map((network) => [network, new Tenderly({ ...config, network })])
    );
  }
  get = (chain: string | number): Tenderly => {
    const tenderly = this.tenderlies[chain.toString()];
    assert(tenderly, `No tenderly instance for chain ${chain}`);
    return tenderly;
  };
}

// TODO: add simulation function
// export function simulateOsnapTx(tenderly: Tenderly) {
//   return [];
// }
