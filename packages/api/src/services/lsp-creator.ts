import { clients } from "@uma/sdk";
import bluebird from "bluebird";
import { AppState, BaseConfig } from "../types";

const { lspCreator } = clients;

interface Config extends BaseConfig {
  network?: number;
  address?: string;
}
type Dependencies = Pick<AppState, "registeredLsps" | "provider" | "registeredLspsMetadata">;

export type EmitData = {
  blockNumber: number;
  address: string;
  startBlock?: number;
  endBlock?: number;
};

export type Events = "created";

export default async (config: Config, appState: Dependencies, emit: (event: Events, data: EmitData) => void) => {
  const { network = 1, address = await lspCreator.getAddress(network) } = config;
  const { registeredLsps, provider, registeredLspsMetadata } = appState;

  const contract = lspCreator.connect(address, provider);

  async function update(startBlock?: number, endBlock?: number) {
    const events = await contract.queryFilter(
      contract.filters.CreatedLongShortPair(null, null, null, null),
      startBlock,
      endBlock
    );
    const { contracts } = lspCreator.getEventState(events);
    if (!contracts) return;
    await bluebird.map(Object.keys(contracts), (address) => {
      const blockNumber = contracts[address].blockNumber;
      registeredLspsMetadata.set(address, { blockNumber });
      registeredLsps.add(address);
      // emit that a new contract was found. Must be done after saving meta data
      emit("created", { address, blockNumber, startBlock, endBlock });
    });
  }

  return {
    update,
  };
};
