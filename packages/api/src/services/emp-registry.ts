import { clients } from "@uma/sdk";
import Promise from "bluebird";
import { AppState } from "..";

const { registry } = clients;

type Config = {
  network?: number;
};
type Dependencies = Pick<AppState, "registeredEmps" | "provider">;

export default (config: Config, appState: Dependencies) => {
  const { network = 1 } = config;
  const { registeredEmps, provider } = appState;
  const address = registry.getAddress(network);
  const contract = registry.connect(address, provider);

  async function update(startBlock?: number | "latest", endBlock?: number) {
    const events = await contract.queryFilter(
      contract.filters.NewContractRegistered(null, null, null),
      startBlock,
      endBlock
    );
    const { contracts } = registry.getEventState(events);
    await Promise.map(Object.keys(contracts || {}), (x) => {
      return registeredEmps.add(x);
    });
  }

  return update;
};
