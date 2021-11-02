import assert from "assert";
import * as uma from "@uma/sdk";
import { BigNumber } from "ethers";
import { Currencies, AppState, PriceSample, BaseConfig } from "../../types";
import { calcTvl, calcTvm, nowS } from "../../libs/utils";
import * as Queries from "../../libs/queries";

interface Config extends BaseConfig {
  currency?: Currencies;
}
type Dependencies = Pick<
  AppState,
  "emps" | "stats" | "prices" | "erc20s" | "registeredEmps" | "synthPrices" | "marketPrices" | "lsps"
>;

// this service is meant to calculate numbers derived from emp state, things like TVL, TVM and other things
export function Emp(config: Config, appState: Dependencies) {
  const { stats, prices, registeredEmps } = appState;
  const { currency = "usd" } = config;

  const queries = Queries.Emp(appState);

  function getTvmHistoryTable() {
    return stats.emp[currency].history.tvm;
  }
  function getTvlHistoryTable() {
    return stats.emp[currency].history.tvl;
  }
  function getLatestTvlTable() {
    return stats.emp[currency].latest.tvl;
  }
  function getLatestTvmTable() {
    return stats.emp[currency].latest.tvm;
  }
  async function updateTvlHistory(empAddress: string) {
    const stat = await getLatestTvlTable().get(empAddress);
    assert(uma.utils.exists(stat.timestamp), "stats require timestamp for emp: " + empAddress);
    assert(uma.utils.exists(stat.value), "No tvl value for emp: " + empAddress);
    if (await getTvlHistoryTable().hasByAddress(empAddress, stat.timestamp)) return stat;
    return getTvlHistoryTable().create({
      address: empAddress,
      value: stat.value,
      timestamp: stat.timestamp,
    });
  }
  async function updateTvmHistory(empAddress: string) {
    const stat = await getLatestTvmTable().get(empAddress);
    assert(uma.utils.exists(stat.timestamp), "stats require timestamp for emp: " + empAddress);
    assert(uma.utils.exists(stat.value), "No tvm value for emp: " + empAddress);
    if (await getTvmHistoryTable().hasByAddress(empAddress, stat.timestamp)) return stat;
    return getTvmHistoryTable().create({
      address: empAddress,
      value: stat.value,
      timestamp: stat.timestamp,
    });
  }

  async function updateTvmHistories(addresses: string[]) {
    return Promise.allSettled(addresses.map(updateTvmHistory));
  }

  async function updateTvlHistories(addresses: string[]) {
    return Promise.allSettled(addresses.map(updateTvlHistory));
  }

  async function getPriceFromTable(empAddress: string, currencyAddress: string) {
    const priceSample = await prices[currency].latest.get(currencyAddress);
    assert(uma.utils.exists(priceSample), "No latest price found for emp: " + empAddress);
    return priceSample;
  }

  async function getFullEmpState(empAddress: string) {
    const emp = await queries.getAny(empAddress);
    // the full state has collateral decimals, pulled from erc20 state
    return queries.getFullState(emp);
  }

  async function updateTvl(emp: uma.tables.emps.Data) {
    assert(emp.collateralCurrency, "TVL Requires collateral currency for emp: " + emp.address);
    const priceSample = await getPriceFromTable(emp.address, emp.collateralCurrency);
    const value = await calcTvl(priceSample.price, emp).toString();
    const update = {
      value,
      timestamp: priceSample.timestamp,
    };
    return stats.emp[currency].latest.tvl.upsert(emp.address, update);
  }
  async function updateTvm(emp: uma.tables.emps.Data) {
    assert(emp.tokenCurrency, "TVM Requires token currency for emp: " + emp.address);
    // collateral amount must be above 1 wei. This was chosen based on looking at contracts with extreme amounts minted, but 1 or less collateral.
    // example bad contracts: 0xa1005DB6516A097E562ad7506CF90ebb511f5604, 0x39450EB4f7DE57f2a25EeE548Ff392532cFB8759
    assert(
      BigNumber.from(emp.totalPositionCollateral || "0").gt("1"),
      "Skipping tvm calculation, too little collateral in EMP: " + emp.address
    );
    const priceSample = await getPriceFromTable(emp.address, emp.tokenCurrency);
    const value = await calcTvm(priceSample.price, emp).toString();
    const update = {
      value,
      timestamp: priceSample.timestamp,
    };
    return stats.emp[currency].latest.tvm.upsert(emp.address, update);
  }
  // update all stats based on array of emp addresses
  async function updateAllTvl(addresses: string[]) {
    // this call can easily error, but we dont want that to prevent all emps to resolve
    // also since this is just calling our db or cache we can use promise.allSettled for speed
    return Promise.allSettled(
      addresses.map(async (address) => {
        const emp = await getFullEmpState(address);
        return updateTvl(emp);
      })
    );
  }
  async function updateAllTvm(addresses: string[]) {
    // this call can easily error, but we dont want that to prevent all emps to resolve
    // also since this is just calling our db or cache we can use promise.allSettled for speed
    return Promise.allSettled(
      addresses.map(async (address) => {
        const emp = await getFullEmpState(address);
        return updateTvm(emp);
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
    // normally you would upsert an emp address where "global" is, but we are going to use a custom value to represent tvl across all addresses
    return stats.emp[currency].latest.tvl.upsertGlobal(update);
  }

  async function update() {
    const addresses = await registeredEmps.keys();
    await updateAllTvl(addresses).then((results) => {
      results.forEach((result) => {
        if (result.status === "rejected") console.error("Error updating tvl: " + result.reason.message);
      });
    });
    await updateGlobalTvl().catch((err) => {
      console.error("Error updating global TVL: " + err.message);
    });
    await updateGlobalTvlHistory().catch((err) => {
      console.error("Error updating global TVL History: " + err.message);
    });
    await updateAllTvm(addresses).then((results) => {
      results.forEach((result) => {
        if (result.status === "rejected") console.error("Error updating tvm: " + result.reason.message);
      });
    });
    await updateTvlHistories(addresses).then((results) => {
      results.forEach((result) => {
        if (result.status === "rejected") console.error("Error updating emp tvl history: " + result.reason.message);
      });
    });
    await updateTvmHistories(addresses).then((results) => {
      results.forEach((result) => {
        if (result.status === "rejected") console.error("Error updating emp tvm history: " + result.reason.message);
      });
    });
  }

  async function backfillTvl(emp: uma.tables.emps.Data, priceSample: PriceSample) {
    assert(emp.collateralCurrency, "Backfill TVL Requires collateral currency for emp: " + emp.address);
    const value = await calcTvl(priceSample[1], emp).toString();
    return getTvlHistoryTable().create({
      address: emp.address,
      timestamp: priceSample[0],
      value,
    });
  }

  async function backfillAllTvl(addresses: string[]) {
    return Promise.allSettled(
      addresses.map(async (address) => {
        const emp = await getFullEmpState(address);
        assert(uma.utils.exists(emp.collateralCurrency), "Emp has no collateral currency: " + emp.address);
        const historicalPrices = await prices[currency].history[emp.collateralCurrency].values();
        return Promise.all(
          historicalPrices.map((priceSample) => {
            return backfillTvl(emp, [priceSample.timestamp, priceSample.price]);
          })
        );
      })
    );
  }

  async function backfill() {
    const addresses = await registeredEmps.keys();
    await backfillAllTvl(addresses).then((results) => {
      results.forEach((result) => {
        if (result.status === "rejected") console.error("Error updating tvl: " + result.reason.message);
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
      updateAllTvm,
      updateTvl,
      updateTvm,
      updateTvlHistory,
      updateTvmHistory,
      updateTvlHistories,
      updateTvmHistories,
      getFullEmpState,
    },
  };
}

export type Emp = ReturnType<typeof Emp>;
