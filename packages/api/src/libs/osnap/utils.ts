import assert from "assert";
import axios from "axios";
import { Network } from "@tenderly/sdk";
import type { OsnapPluginData, Transaction } from "./interfaces";

// a list of chains osnap is enabled on. must be updated manually as we add more
export const ChainsEnabled: Network[] = [
  Network.MAINNET,
  Network.GOERLI,
  Network.POLYGON,
  Network.OPTIMISTIC,
  Network.ARBITRUM_ONE,
];

export type TenderlyApiConfig = {
  accountName: string;
  projectName: string;
  accessKey: string;
};
export type SimulationRequest = {
  save: boolean;
  save_if_fails: boolean;
  simulation_type: "full" | "quick";
  network_id: string;
  from: string;
  to: string;
  input: string;
  gas: number;
  state_objects: {
    [address: string]: {
      storage: {
        [key: string]: string;
      };
    };
  };
};

export type SimulationResponse = {
  simulation: {
    id: string;
    status: boolean;
  };
};

export type SimulationBundleRequest = {
  simulations: SimulationRequest[];
};
export class TenderlyApi {
  constructor(private config: TenderlyApiConfig) {}
  getTenderlyApiUrl(): string {
    return `https://api.tenderly.co/api/v1/account/${this.config.accountName}/project/${this.config.projectName}/simulate`;
  }
  // this runs a single transaction simulation, tenderly can also support an array but this changes input/output
  simulate = async (params: SimulationRequest): Promise<SimulationResponse> => {
    const result = await axios.post(this.getTenderlyApiUrl(), params, {
      headers: {
        "X-Access-Key": this.config.accessKey,
      },
    });
    return result.data as SimulationResponse;
  };
  async simulateOsnapTx(space: OsnapPluginData): Promise<{ id: string; status: boolean }> {
    const { safe } = space;
    assert(safe, "Requires a safe");
    const { network, transactions } = safe;
    const [transaction] = transactions;
    const result = await this.simulate(this.mapOsnapTxToTenderlySim(transaction, network));
    return {
      id: result.simulation.id,
      status: result.simulation.status,
    };
  }
  mapOsnapTxToTenderlySim(tx: Transaction, network_id: string): SimulationRequest {
    return {
      save: true,
      save_if_fails: true,
      simulation_type: "quick",
      network_id,
      from: "0x0000000000000000000000000000000000000000",
      to: tx.to,
      input: tx.data,
      gas: 8000000,
      // TODO: figure out state overrides here
      state_objects: {},
    };
  }
}
