import { clients } from "@uma/sdk";
import bluebird from "bluebird";
import { AppClients, AppState, BaseConfig } from "../types";
import { LspCreator, EmitData, Events } from "./lsp-creator";

const { lspCreator } = clients;

interface Config extends BaseConfig {
  addresses?: string[];
  network: number;
  debug?: boolean;
}
type Dependencies = {
  tables: Pick<AppState, "registeredLsps">;
  appClients: AppClients;
};
export type { EmitData };

export type { Events };

export default async (
  config: Config,
  dependencies: Dependencies,
  emit: (event: Events, data: EmitData) => void = () => {
    return;
  }
) => {
  const { addresses = [], network } = config;

  // always include latest known address
  const latestAddress = await lspCreator.getAddress(network);

  // make sure we dont have duplicate addresses ( case sensitive)
  const allAddresses = Array.from(new Set([...addresses, latestAddress]));

  // instantiate individual lsp creator services with a single address
  const creatorServices = allAddresses.map((address) => LspCreator({ address, ...config }, dependencies, emit));

  // run update on all creator services
  async function update(startBlock?: number, endBlock?: number) {
    await bluebird.mapSeries(creatorServices, (service) => service.update(startBlock, endBlock));
  }

  return {
    update,
  };
};
