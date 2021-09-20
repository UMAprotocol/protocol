import { clients } from "@uma/sdk";
import bluebird from "bluebird";
import { AppState, BaseConfig } from "..";

const { registry } = clients;

interface Config extends BaseConfig {
  network?: number;
}
type Dependencies = Pick<AppState, "registeredEmps" | "provider" | "registeredEmpsMetadata">;

export type EmitData = {
  blockNumber: number;
  address: string;
  startBlock?: number;
  endBlock?: number;
};

export default async (config: Config, appState: Dependencies, emit: (data: EmitData) => void) => {
  const { network = 1 } = config;
  const { registeredEmps, provider, registeredEmpsMetadata } = appState;
  const address = await registry.getAddress(network);
  const contract = registry.connect(address, provider);

  async function update(startBlock?: number, endBlock?: number) {
    const events = await contract.queryFilter(
      contract.filters.NewContractRegistered(null, null, null),
      startBlock,
      endBlock
    );
    const { contracts } = registry.getEventState(events);
    if (!contracts) return;

    await bluebird.map(Object.keys(contracts), (address) => {
      const blockNumber = contracts[address].blockNumber;
      registeredEmpsMetadata.set(address, { blockNumber });
      registeredEmps.add(address);
      emit({ address, blockNumber, startBlock, endBlock });
    });
  }

  return update;
};
