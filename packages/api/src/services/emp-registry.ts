import { clients } from "@uma/sdk";
import Promise from "bluebird";
import { Libs } from "..";

const { Registry } = clients;

type Config = {
  network?: number;
};
export default (config: Config, libs: Libs) => {
  const { network = 1 } = config;
  const { registeredEmps, provider } = libs;
  const address = Registry.getAddress(network)
  const contract = Registry.connect(address,provider);

  async function update(startBlock?: number | "latest", endBlock?: number) {
    const events = await contract.queryFilter(
      contract.filters.NewContractRegistered(null, null, null),
      startBlock,
      endBlock
    );
    const { contracts } = Registry.getEventState(events);
    await Promise.map(Object.keys(contracts || {}), (x) => {
      return registeredEmps.add(x);
    });
  }

  return update;
};
