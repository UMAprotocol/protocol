import { Awaited } from "@uma/financial-templates-lib/dist/types";
import { clients } from "@uma/sdk";
import bluebird from "bluebird";
import { AppClients, AppState, BaseConfig } from "../types";

const { lspCreator } = clients;

interface Config extends BaseConfig {
  network: number;
  address?: string;
}
type Dependencies = {
  tables: Pick<AppState, "registeredLsps">;
  appClients: AppClients;
};

export type EmitData = {
  blockNumber: number;
  address: string;
  startBlock?: number;
  endBlock?: number;
};

export type Events = "created";

export const LspCreator = async (
  config: Config,
  dependencies: Dependencies,
  emit: (event: Events, data: EmitData) => void
) => {
  const { network, address = await lspCreator.getAddress(network) } = config;
  const { appClients, tables } = dependencies;
  const { registeredLsps } = tables;
  const { provider } = appClients;
  const contract = lspCreator.connect(address, provider);

  async function update(startBlock?: number, endBlock?: number) {
    const events = await contract.queryFilter(
      contract.filters.CreatedLongShortPair(null, null, null, null),
      startBlock,
      endBlock
    );
    const { contracts } = lspCreator.getEventState(events);
    if (!contracts) return;
    await bluebird.map(Object.keys(contracts), async (address) => {
      const blockNumber = contracts[address].blockNumber;
      await registeredLsps.set({
        address,
        id: address,
        blockNumber,
      });
      // emit that a new contract was found. Must be done after saving meta data
      emit("created", { address, blockNumber, startBlock, endBlock });
    });
  }

  return {
    update,
  };
};

export type LspCreator = Awaited<ReturnType<typeof LspCreator>>;
