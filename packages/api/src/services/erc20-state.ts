import { clients } from "@uma/sdk";
import { Libs, Json } from "..";
import { asyncValues } from "../libs/utils";
type Config = Json;
export default function (config: Config, libs: Libs) {
  const { provider, erc20s, collateralAddresses, syntheticAddresses } = libs;
  async function getTokenState(address: string) {
    const instance = clients.erc20.connect(address, provider);
    return asyncValues({
      address,
      // just in case these fail, return null
      decimals: instance.decimals().catch((err) => null),
      name: instance.name().catch((err) => null),
      symbol: instance.symbol().catch((err) => null),
    });
  }
  async function updateToken(address: string) {
    if (await erc20s.has(address)) return;
    const state = await getTokenState(address);
    return erc20s.upsert(address, state);
  }
  async function updateTokens(addresses: string[]) {
    return Promise.allSettled(addresses.map(updateToken));
  }

  async function update() {
    const addresses = [...collateralAddresses.values(), ...syntheticAddresses.values()];
    await updateTokens(addresses).then((results) => {
      results.forEach((result) => {
        if (result.status === "rejected") console.error("Error getting token info: " + result.reason.message);
      });
    });
  }
  return {
    update,
    getTokenState,
    updateToken,
    updateTokens,
  };
}
