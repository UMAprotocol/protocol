import { clients } from "@uma/sdk";
import bluebird from "bluebird";
import { AppState, BaseConfig } from "..";
import LspCreator from "./lsp-creator";

const { lspCreator } = clients;

interface Config extends BaseConfig {
  addresses?: string[];
  network?: number;
  debug?: boolean;
}
type Dependencies = Pick<AppState, "registeredLsps" | "provider">;

export default (config: Config, appState: Dependencies) => {
  const { addresses = [], network = 1 } = config;

  // always include latest known address
  const latestAddress = lspCreator.getAddress(network);

  // make sure we dont have duplicate addresses ( case sensitive)
  const allAddresses = Array.from(new Set([...addresses, latestAddress]));

  // instantiate individual lsp creator services with a single address
  const creatorServices = allAddresses.map((address) => LspCreator({ address, ...config }, appState));

  // run update on all creator services
  async function update(startBlock?: number | "latest", endBlock?: number) {
    await bluebird.mapSeries(creatorServices, (service) => service.update(startBlock, endBlock));
  }

  return {
    update,
  };
};
