import assert from "assert";
import * as uma from "@uma/sdk";
import { Currencies, AppState, BaseConfig } from "../..";
import * as Queries from "../../libs/queries";
import { BigNumber } from "ethers";
import bluebird from "bluebird";

interface Config extends BaseConfig {
  currency?: Currencies;
}
type Dependencies = Pick<
  AppState,
  "synthPrices" | "marketPrices" | "emps" | "registeredEmps" | "lsps" | "stats" | "prices" | "erc20s" | "registeredLsps"
>;

// this service is meant to calculate numbers derived from lsp state, things like TVL, TVM and other things
export default (config: Config, appState: Dependencies) => {
  const { currency = "usd" } = config;
  const queries = [Queries.Emp(appState), Queries.Lsp(appState)];
  const stats = appState.stats.global;

  async function updateTvlHistory() {
    const [timestamp, value] = stats[currency].latest.tvl;
    assert(uma.utils.exists(timestamp), "stats require global TVL timestamp");
    assert(uma.utils.exists(value), "stats require TVL global TVL value");
    if (await stats[currency].history.tvl.hasGlobal(timestamp)) return;
    return stats[currency].history.tvl.createGlobal({
      value,
      timestamp,
    });
  }
  async function updateLatestTvl() {
    const result = await bluebird.reduce(
      queries,
      async (result, queries) => {
        const sample = await queries.getTotalTvlSample(currency);
        result.timestamp = Math.max(result.timestamp, sample.timestamp || 0);
        result.value = result.value.add(sample.value || "0");
        return result;
      },
      { timestamp: 0, value: BigNumber.from("0") }
    );
    stats[currency].latest.tvl = [result.timestamp, result.value.toString()];
  }
  async function update() {
    await updateLatestTvl().catch((err) => {
      console.error("Error updating latest global TVL: " + err.message);
    });
    await updateTvlHistory().catch((err) => {
      console.error("Error updating latest global TVL history: " + err.message);
    });
  }

  return {
    update,
  };
};
