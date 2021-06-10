import assert from "assert";
import * as uma from "@uma/sdk";
import { Json, Actions, Libs, CurrencySymbol } from "..";

const { exists } = uma.utils;

export function Handlers(config: Json, libs: Libs): Actions {
  const actions: Actions = {
    echo(...args: Json[]) {
      return args;
    },
    listEmpAddresses() {
      return [...libs.registeredEmps.values()];
    },
    lastBlock() {
      return libs.lastBlock;
    },
    async listActiveEmps() {
      return libs.emps.active.values();
    },
    async listExpiredEmps() {
      return libs.emps.expired.values();
    },
    async sliceBlocks(start = -1, end?: number) {
      const blocks = await libs.blocks.values();
      return blocks.slice(start, end);
    },
    async collateralAddresses() {
      return Array.from(libs.collateralAddresses.values());
    },
    async syntheticAddresses() {
      return Array.from(libs.syntheticAddresses.values());
    },
    async allLatestPrices(currency: CurrencySymbol = "usd") {
      assert(exists(libs.prices[currency]), "invalid currency type: " + currency);
      return libs.prices[currency].latest;
    },
    async latestPriceByAddress(address: string, currency: CurrencySymbol = "usd") {
      assert(address, "requires an erc20 token address");
      assert(exists(libs.prices[currency]), "invalid currency type: " + currency);
      const priceSample = libs.prices[currency].latest[address];
      assert(exists(priceSample), "No price for address: " + address);
      return priceSample;
    },
  };

  // list all available actions
  const keys = Object.keys(actions);
  actions.actions = () => keys;

  return actions;
}
export default (config: Json, libs: Libs) => {
  const actions = Handlers(config, libs);
  return async (action: string, ...args: Json[]) => {
    assert(actions[action], `Invalid action: ${action}`);
    return actions[action](...args);
  };
};
