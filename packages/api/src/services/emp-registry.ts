import { Awaited } from "@uma/financial-templates-lib/dist/types";
import { clients } from "@uma/sdk";
import bluebird from "bluebird";
import { AppClients, AppState, BaseConfig } from "../types";

const { registry } = clients;

interface Config extends BaseConfig {
  network: number;
  registryAddress?: string;
}

export type EmitData = {
  blockNumber: number;
  address: string;
  startBlock?: number;
  endBlock?: number;
};

// type of events
export type Events = "created";
type Dependencies = {
  tables: Pick<AppState, "registeredEmps">;
  appClients: AppClients;
};
export const Registry = async (
  config: Config,
  dependencies: Dependencies,
  emit: (event: Events, data: EmitData) => void = () => {
    return;
  }
) => {
  const { network, registryAddress } = config;
  const { appClients, tables } = dependencies;
  const { registeredEmps } = tables;
  const { provider } = appClients;
  const address = registryAddress || (await registry.getAddress(network));
  const contract = registry.connect(address, provider);

  async function update(startBlock?: number, endBlock?: number) {
    const events = await contract.queryFilter(
      contract.filters.NewContractRegistered(null, null, null),
      startBlock,
      endBlock
    );
    const { contracts } = registry.getEventState(events);
    if (!contracts) return;

    await bluebird.map(Object.keys(contracts), async (address) => {
      const blockNumber = contracts[address].blockNumber;
      await registeredEmps.set({
        id: address,
        address,
        blockNumber,
      });
      emit("created", { address, blockNumber, startBlock, endBlock });
    });
  }

  return update;
};

export type Registry = Awaited<ReturnType<typeof Registry>>;
