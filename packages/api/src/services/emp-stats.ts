import assert from "assert";
import * as uma from "@uma/sdk";
import { Currencies, AppState, PriceSample } from "..";
import { empStatsHistory, empStats } from "../tables";
import { calcTvl, calcTvm, nowS } from "../libs/utils";
import Queries from "../libs/queries";

type EmpHistoryStat = empStatsHistory.Data;
type Config = {
  currency?: Currencies;
};
type Dependencies = Pick<AppState, "emps" | "stats" | "prices" | "erc20s" | "registeredEmps" | "synthPrices">;

// this service is meant to calculate numbers derived from emp state, things like TVL, TVM and other things
export default (config: Config, appState: Dependencies) => {
  const { stats, prices, registeredEmps, synthPrices } = appState;
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

  async function updateHistory(empAddress: string) {
    const stat = await getLatestStats(empAddress);
    assert(uma.utils.exists(stat.timestamp), "stats require timestamp for emp: " + empAddress);
    if (await hasStatsHistory(empAddress, stat.timestamp)) return stat;
    // remove id from the latest stats, since this gets overriden with history stats by timestamp
    const { id, ...historyStat } = stat;
    return createStatHistory(empAddress, historyStat as EmpHistoryStat);
  }
  async function updateHistories(addresses: string[]) {
    return Promise.allSettled(addresses.map(updateHistory));
  }

  // synthetic prices return price in wei, due to the way the bot price feeds work
  async function getSyntheticPriceFromTable(empAddress: string) {
    // PriceSample is type [ timestamp:number, price:string]
    const priceSample: PriceSample = synthPrices.latest[empAddress];
    assert(uma.utils.exists(priceSample), "No latest synthetic price found for emp: " + empAddress);
    const [, price] = priceSample;
    return price;
  }

  async function getPriceFromTable(empAddress: string, currencyAddress: string) {
    // PriceSample is type [ timestamp:number, price:string]
    const priceSample: PriceSample = prices[currency].latest[currencyAddress];
    assert(uma.utils.exists(priceSample), "No latest price found for emp: " + empAddress);
    const [, price] = priceSample;
    return price;
  }

  async function getFullEmpState(empAddress: string) {
    const emp = await queries.getAnyEmp(empAddress);
    // the full state has collateral decimals, pulled from erc20 state
    return queries.getFullEmpState(emp);
  }
  async function updateStats(empAddress: string) {
    const update: empStats.Data = { address: empAddress };

    const emp = await getFullEmpState(empAddress);
    update.timestamp = nowS();

    if (uma.utils.exists(emp.collateralCurrency)) {
      const collateralPrice = await getPriceFromTable(empAddress, emp.collateralCurrency).catch(() => undefined);
      if (collateralPrice !== undefined) {
        update.collateralPrice = collateralPrice;
        update.tvl = calcTvl(update.collateralPrice, emp).toString();
      }
    }

    if (uma.utils.exists(emp.tokenCurrency)) {
      const syntheticPrice = await getPriceFromTable(empAddress, emp.tokenCurrency).catch(() => undefined);
      if (syntheticPrice !== undefined) {
        update.syntheticPrice = syntheticPrice;
        update.tvm = calcTvm(update.syntheticPrice, emp).toString();
      }
    }

    const rawSyntheticPrice = await getSyntheticPriceFromTable(empAddress).catch(() => undefined);
    if (rawSyntheticPrice !== undefined) {
      // get the raw synth price for sanity check
      update.rawSyntheticPrice = rawSyntheticPrice;
    }

    return stats[currency].latest.upsert(empAddress, update);
  }

  // update all stats based on array of emp addresses
  async function updateAllStats(addresses: string[]) {
    // this call can easily error, but we dont want that to prevent all emps to resolve
    // also since this is just calling our db or cache we can use promise.allSettled for speed
    return Promise.allSettled(addresses.map(updateStats));
  }

  async function update() {
    const addresses = Array.from(registeredEmps.values());
    await updateAllStats(addresses).then((results) => {
      results.forEach((result) => {
        if (result.status === "rejected") console.error("Error updating stats: " + result.reason.message);
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
      updateHistories,
      updateHistory,
      updateStats,
      updateAllStats,
      getPriceFromTable,
      getFullEmpState,
    },
  };
};
