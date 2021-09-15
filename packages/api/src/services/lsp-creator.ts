import { clients } from "@uma/sdk";
import bluebird from "bluebird";
import { AppState, BaseConfig } from "..";

const { lspCreator } = clients;

interface Config extends BaseConfig {
  network?: number;
  address?: string;
}
type Dependencies = Pick<AppState, "registeredLsps" | "provider" | "registeredLspsMetadata">;

export default async (config: Config, appState: Dependencies) => {
  const { network = 1, address = await lspCreator.getAddress(network) } = config;
  const { registeredLsps, provider, registeredLspsMetadata } = appState;

  const contract = lspCreator.connect(address, provider);

  async function update(startBlock?: number | "latest", endBlock?: number) {
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
      return registeredLsps.add(address);
    });
  }

  return {
    update,
  };
};
