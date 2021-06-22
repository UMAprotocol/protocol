// allow for more complex queries, joins and shared queries between services
import type { AppState, CurrencySymbol } from "..";
import uma from "@uma/sdk";
import { calcGcr } from "./utils";
import Promise from "bluebird";
import { BigNumber } from "ethers";

type Dependencies = Pick<AppState, "erc20s" | "emps" | "stats" | "registeredEmps">;

export default (appState: Dependencies) => {
  async function getAnyEmp(empAddress: string) {
    if (await appState.emps.active.has(empAddress)) {
      return appState.emps.active.get(empAddress);
    }
    return appState.emps.expired.get(empAddress);
  }
  // joins emp with token state and gcr
  async function getFullEmpState(empState: uma.tables.emps.Data) {
    const token = empState.tokenCurrency ? await appState.erc20s.get(empState.tokenCurrency).catch(() => null) : null;
    const collateral = empState.collateralCurrency
      ? await appState.erc20s.get(empState.collateralCurrency).catch(() => null)
      : null;

    const state = {
      ...empState,
      tokenDecimals: token?.decimals,
      collateralDecimals: collateral?.decimals,
      tokenName: token?.name,
      collateralName: collateral?.name,
    };
    let gcr = "0";
    try {
      gcr = calcGcr(state).toString();
    } catch (err) {
      // nothing
    }
    return {
      ...state,
      gcr,
    };
  }

  async function listActiveEmps() {
    const emps = appState.emps.active.values();
    return Promise.map(emps, (emp) => getFullEmpState(emp).catch(() => emp));
  }
  async function listExpiredEmps() {
    const emps = appState.emps.expired.values();
    return Promise.map(emps, (emp) => getFullEmpState(emp).catch(() => emp));
  }

  async function sumTvl(addresses: string[], currency: CurrencySymbol = "usd") {
    const tvl = await Promise.reduce(
      addresses,
      async (sum, address) => {
        const stats = await appState.stats[currency].latest.getOrCreate(address);
        return sum.add(stats.tvl || "0");
      },
      BigNumber.from("0")
    );
    return tvl.toString();
  }
  async function totalTvl(currency: CurrencySymbol = "usd") {
    const addresses = Array.from(appState.registeredEmps.values());
    return sumTvl(addresses, currency);
  }

  return {
    getFullEmpState,
    getAnyEmp,
    listActiveEmps,
    listExpiredEmps,
    totalTvl,
    sumTvl,
  };
};
