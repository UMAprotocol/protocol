import assert from "assert";
import * as uma from "@uma/sdk";
import { Currencies, AppState, PriceSample, BaseConfig } from "../../types";
import { calcTvl, nowS } from "../../libs/utils";
import * as Queries from "../../libs/queries";
import * as tables from "../../tables";

interface Config extends BaseConfig {
  currency?: Currencies;
}
type Dependencies = Pick<AppState, "lsps" | "stats" | "prices" | "erc20s" | "registeredLsps">;

// this service is meant to calculate numbers derived from lsp state, things like TVL, TVM and other things
export function Lsp(config: Config, appState: Dependencies) {
  const { prices, registeredLsps } = appState;
  const { currency = "usd" } = config;
  const stats = appState.stats.lsp;
  const queries = Queries.Lsp(appState);

  function getTvlHistoryTable() {
    return stats[currency].history.tvl;
  }
  function getLatestTvlTable() {
    return stats[currency].latest.tvl;
  }
  async function updateTvlHistory(contractAddress: string) {
    const stat = await getLatestTvlTable().get(contractAddress);
    assert(uma.utils.exists(stat.timestamp), "stats require timestamp for LSP: " + contractAddress);
    assert(uma.utils.exists(stat.value), "No tvl value for LSP: " + contractAddress);
    if (await getTvlHistoryTable().hasByAddress(contractAddress, stat.timestamp)) return stat;
    return getTvlHistoryTable().create({
      address: contractAddress,
      value: stat.value,
      timestamp: stat.timestamp,
    });
  }
  async function updateTvlHistories(addresses: string[]) {
    return Promise.allSettled(addresses.map(updateTvlHistory));
  }

  async function getPriceFromTable(contractAddress: string, currencyAddress: string) {
    const priceSample = await prices[currency].latest.get(currencyAddress);
    assert(uma.utils.exists(priceSample), "No latest price found for LSP: " + contractAddress);
    return priceSample;
  }

  async function getFullState(contractAddress: string) {
    const result = await queries.getAny(contractAddress);
    // the full state has collateral decimals, pulled from erc20 state
    return queries.getFullState(result);
  }

  async function updateTvl(data: tables.lsps.Data) {
    assert(data.collateralToken, "TVL Requires collateral currency for LSP: " + data.address);
    const priceSample = await getPriceFromTable(data.address, data.collateralToken);
    const value = await calcTvl(priceSample.price, data).toString();
    const update = {
      value,
      timestamp: priceSample.timestamp,
    };
    return stats[currency].latest.tvl.upsert(data.address, update);
  }
  // update all stats based on array of LSP addresses
  async function updateAllTvl(addresses: string[]) {
    // this call can easily error, but we dont want that to prevent all LSPs to resolve
    // also since this is just calling our db or cache we can use promise.allSettled for speed
    return Promise.allSettled(
      addresses.map(async (address) => {
        const data = await getFullState(address);
        return updateTvl(data);
      })
    );
  }
  // TVM for LSP will just be the TVL
  async function updateTvm(address: string) {
    const tvl = await stats[currency].latest.tvl.get(address);
    return stats[currency].latest.tvm.upsert(address, tvl);
  }
  // update all stats based on array of LSP addresses
  async function updateAllTvm(addresses: string[]) {
    return Promise.allSettled(
      addresses.map(async (address) => {
        return updateTvm(address);
      })
    );
  }

  async function updateGlobalTvlHistory() {
    const latest = getLatestTvlTable();
    const history = getTvlHistoryTable();
    const stat = await latest.getGlobal();
    assert(uma.utils.exists(stat.timestamp), "stats require global TVL timestamp");
    assert(uma.utils.exists(stat.value), "stats require TVL global TVL value");
    if (await history.hasGlobal(stat.timestamp)) return stat;
    return history.createGlobal({
      value: stat.value,
      timestamp: stat.timestamp,
    });
  }
  async function updateGlobalTvl() {
    const value = await queries.totalTvl(currency);
    const update = {
      value,
      timestamp: nowS(),
    };
    // normally you would upsert an lsp address where "global" is, but we are going to use a custom value to represent tvl across all addresses
    return stats[currency].latest.tvl.upsertGlobal(update);
  }
  // tvm is just based on TVL for LSPS.
  async function updateGlobalTvm() {
    const value = await queries.totalTvm(currency);
    const update = {
      value,
      timestamp: nowS(),
    };
    // normally you would upsert an lsp address where "global" is, but we are going to use a custom value to represent tvl across all addresses
    return stats[currency].latest.tvm.upsertGlobal(update);
  }
  async function update() {
    const addresses = await registeredLsps.keys();
    await updateAllTvl(addresses).then((results) => {
      results.forEach((result) => {
        if (result.status === "rejected") console.error("Error updating TVL: " + result.reason.message);
      });
    });
    await updateAllTvm(addresses).then((results) => {
      results.forEach((result) => {
        if (result.status === "rejected") console.error("Error updating TVM: " + result.reason.message);
      });
    });
    await updateGlobalTvl().catch((err) => {
      console.error("Error updating global TVL: " + err.message);
    });
    await updateGlobalTvm().catch((err) => {
      console.error("Error updating global TVM: " + err.message);
    });
    await updateGlobalTvlHistory().catch((err) => {
      console.error("Error updating global TVL History: " + err.message);
    });
    await updateTvlHistories(addresses).then((results) => {
      results.forEach((result) => {
        if (result.status === "rejected") console.error("Error updating LSP TVL history: " + result.reason.message);
      });
    });
  }

  async function backfillTvl(data: tables.lsps.Data, priceSample: PriceSample) {
    assert(data.collateralToken, "Backfill TVL Requires collateral token for LSP: " + data.address);
    const value = await calcTvl(priceSample[1], data).toString();
    return getTvlHistoryTable().create({
      address: data.address,
      timestamp: priceSample[0],
      value,
    });
  }

  async function backfillAllTvl(addresses: string[]) {
    return Promise.allSettled(
      addresses.map(async (address) => {
        const data = await getFullState(address);
        assert(uma.utils.exists(data.collateralToken), "LSP has no collateral currency: " + data.address);
        const historicalPrices = await prices[currency].history[data.collateralToken].values();
        return Promise.all(
          historicalPrices.map((priceSample) => {
            return backfillTvl(data, [priceSample.timestamp, priceSample.price]);
          })
        );
      })
    );
  }

  async function backfill() {
    const addresses = await registeredLsps.keys();
    await backfillAllTvl(addresses).then((results) => {
      results.forEach((result) => {
        if (result.status === "rejected") console.error("Error updating TVL: " + result.reason.message);
      });
    });
  }

  return {
    update,
    backfill,
    utils: {
      backfillAllTvl,
      backfillTvl,
      updateAllTvl,
      updateTvl,
      updateTvlHistory,
      updateTvlHistories,
      getFullState,
    },
  };
}

export type Lsp = ReturnType<typeof Lsp>;
