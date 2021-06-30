import assert from "assert";
import * as uma from "@uma/sdk";
export { BigNumber, utils } from "ethers";
import { Currencies, AppState, PriceSample } from "..";
import { calcTvl, calcTvm } from "../libs/utils";
import Queries from "../libs/queries";

type Config = {
  currency?: Currencies;
};
type Dependencies = Pick<AppState, "emps" | "stats" | "prices" | "erc20s" | "registeredEmps">;

// this service is meant to calculate numbers derived from emp state, things like TVL, TVM and other things
export default (config: Config, appState: Dependencies) => {
  const { stats, prices, registeredEmps } = appState;
  const { currency = "usd" } = config;

  const queries = Queries(appState);

  function getTvmHistoryTable() {
    return stats[currency].history.tvm;
  }
  function getTvlHistoryTable() {
    return stats[currency].history.tvl;
  }
  function getLatestTvlTable() {
    return stats[currency].latest.tvl;
  }
  function getLatestTvmTable() {
    return stats[currency].latest.tvm;
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
    // PriceSample is type [ timestamp:number, price:string]
    const priceSample: PriceSample = prices[currency].latest[currencyAddress];
    assert(uma.utils.exists(priceSample), "No latest price found for emp: " + empAddress);
    return priceSample;
  }

  async function getFullEmpState(empAddress: string) {
    const emp = await queries.getAnyEmp(empAddress);
    // the full state has collateral decimals, pulled from erc20 state
    return queries.getFullEmpState(emp);
  }

  async function updateTvl(emp: uma.tables.emps.Data) {
    assert(emp.collateralCurrency, "TVL Requires collateral currency for emp: " + emp.address);
    const priceSample = await getPriceFromTable(emp.address, emp.collateralCurrency);
    const value = await calcTvl(priceSample[1], emp).toString();
    const update = {
      value,
      timestamp: priceSample[0],
    };
    return stats[currency].latest.tvl.upsert(emp.address, update);
  }
  async function updateTvm(emp: uma.tables.emps.Data) {
    assert(emp.tokenCurrency, "TVL Requires token currency for emp: " + emp.address);
    const priceSample = await getPriceFromTable(emp.address, emp.tokenCurrency);
    const value = await calcTvm(priceSample[1], emp).toString();
    const update = {
      value,
      timestamp: priceSample[0],
    };
    return stats[currency].latest.tvm.upsert(emp.address, update);
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

  async function update() {
    const addresses = Array.from(registeredEmps.values());
    await updateAllTvl(addresses).then((results) => {
      results.forEach((result) => {
        if (result.status === "rejected") console.error("Error updating tvl: " + result.reason.message);
      });
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

  return {
    update,
    utils: {
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
};
