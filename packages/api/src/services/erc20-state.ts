import { clients } from "@uma/sdk";
import { AppClients, AppState, BaseConfig } from "../types";
import { asyncValues } from "../libs/utils";

type Config = BaseConfig;
// break out this services specific state dependencies
type Dependencies = {
  tables: Pick<AppState, "erc20s" | "collateralAddresses" | "syntheticAddresses" | "longAddresses" | "shortAddresses">;
  appClients: AppClients;
};

export function Erc20s(config: Config, dependencies: Dependencies) {
  const { tables, appClients } = dependencies;
  const { erc20s, collateralAddresses, syntheticAddresses, longAddresses, shortAddresses } = tables;

  // get token state based on contract
  async function getTokenStateFromContract(address: string) {
    const instance = clients.erc20.connect(address, appClients.provider);
    return asyncValues({
      address,
      // just in case these fail, return null
      decimals: instance.decimals().catch(() => null),
      name: instance.name().catch(() => null),
      symbol: instance.symbol().catch(() => null),
    });
  }

  async function updateToken(address: string) {
    if (await erc20s.has(address)) return;
    const state = await getTokenStateFromContract(address);
    return erc20s.upsert(address, state);
  }

  // update all tokens based on address, but dont throw errors.
  async function updateTokens(addresses: string[]) {
    return Promise.allSettled(addresses.map(updateToken));
  }

  async function update() {
    const addresses = new Set([
      ...(await collateralAddresses.keys()),
      ...(await syntheticAddresses.keys()),
      ...(await longAddresses.keys()),
      ...(await shortAddresses.keys()),
    ]);
    await updateTokens(Array.from(addresses)).then((results) => {
      results.forEach((result) => {
        if (result.status === "rejected") console.error("Error getting token info: " + result.reason.message);
      });
    });
  }
  return {
    update,
    // internal functions meant to support updating
    utils: {
      getTokenStateFromContract,
      updateToken,
      updateTokens,
    },
  };
}

export type Erc20s = ReturnType<typeof Erc20s>;
