import { clients } from "@uma/sdk";
import bluebird from "bluebird";
import { AppState, BaseConfig } from "..";

const { lspCreator } = clients;

interface Config extends BaseConfig {
  network?: number;
  address?: string;
}
type Dependencies = Pick<AppState, "registeredLsps" | "provider">;

export default (config: Config, appState: Dependencies) => {
  const { network = 1, address = lspCreator.getAddress(network) } = config;
  const { registeredLsps, provider } = appState;

  const contract = lspCreator.connect(address, provider);

  async function update(startBlock?: number | "latest", endBlock?: number) {
    const events = await contract.queryFilter(
      contract.filters.CreatedLongShortPair(null, null, null, null),
      startBlock,
      endBlock
    );
    const { contracts } = lspCreator.getEventState(events);
    await bluebird.map(Object.keys(contracts || {}), (x) => {
      return registeredLsps.add(x);
    });
  }

  return {
    update,
  };
};
