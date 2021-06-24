import assert from "assert";
import * as uma from "@uma/sdk";
export { BigNumber, utils } from "ethers";
import { Currencies, AppState, PriceSample } from "..";
import { empStatsHistory } from "../tables";
import { calcTvl } from "../libs/utils";
import Queries from "../libs/queries";

type EmpHistoryStat = empStatsHistory.Data;
type Config = {
  currency?: Currencies;
};
type Dependencies = Pick<AppState, "emps" | "stats" | "prices" | "erc20s" | "registeredEmps">;

// this service is meant to calculate numbers derived from emp state, things like TVL, TVM and other things
export default (config: Config, appState: Dependencies) => {
  const { stats, prices, registeredEmps } = appState;
  const { currency = "usd" } = config;

  const queries = Queries(appState);

  async function getLatestStats(address: string) {
    return stats[currency].latest.getOrCreate(address);
  }
  function getOrCreateHistoryTable(address: string) {
    if (!stats[currency].history[address])
      stats[currency].history[address] = empStatsHistory.SortedJsMap("Emp Stat History for " + address);
    return stats[currency].history[address];
  }
  async function hasStatsHistory(address: string, timestamp: number) {
    return getOrCreateHistoryTable(address).has(timestamp);
  }
  async function createStatHistory(address: string, data: EmpHistoryStat) {
    return getOrCreateHistoryTable(address).create(data);
  }

  async function updateHistory(address: string) {
    const stat = await getLatestStats(address);
    assert(uma.utils.exists(stat.timestamp), "stats require timestamp");
    if (await hasStatsHistory(address, stat.timestamp)) return stat;
    const update = {
      address: stat.address,
      tvl: stat.tvl,
      tvm: stat.tvm,
      timestamp: stat.timestamp,
    };
    return createStatHistory(address, update);
  }

  async function updateHistories(addresses: string[]) {
    return Promise.allSettled(addresses.map(updateHistory));
  }

  async function updateLatestTvl(address: string) {
    const emp = await queries.getAnyEmp(address);
    // the full state has collateral decimals, pulled from erc20 state
    const fullState = await queries.getFullEmpState(emp);

    assert(uma.utils.exists(fullState.collateralCurrency), "Emp requires collateralCurrency: " + address);

    // PriceSample is type [ timestamp:number, price:string]
    const priceSample: PriceSample = prices[currency].latest[fullState.collateralCurrency];
    assert(uma.utils.exists(priceSample), "No latest price found for emp: " + address);
    const [timestamp, price] = priceSample;
    assert(uma.utils.exists(price), "Invalid latest price found on emp: " + address);

    const tvl = calcTvl(price, fullState).toString();
    return stats[currency].latest.upsert(address, { tvl, timestamp });
  }

  async function updateLatestTvls(addresses: string[]) {
    // this call can easily error, but we dont want that to prevent all emps to resolve
    // also since this is just calling our db or cache we can use promise.allSettled for speed
    return Promise.allSettled(addresses.map(updateLatestTvl));
  }

  async function update() {
    const addresses = Array.from(registeredEmps.values());
    await updateLatestTvls(addresses).then((results) => {
      results.forEach((result) => {
        if (result.status === "rejected") console.error("Error updating TVL: " + result.reason.message);
      });
    });
    await updateHistories(addresses).then((results) => {
      results.forEach((result) => {
        if (result.status === "rejected") console.error("Error updating emp stat history: " + result.reason.message);
      });
    });
  }

  return {
    update,
    utils: {
      updateLatestTvl,
      updateLatestTvls,
      updateHistories,
      updateHistory,
    },
  };
};
