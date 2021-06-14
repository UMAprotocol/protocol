// allow for more complex queries, joins and shared queries between services
import type { AppState } from "..";
import uma from "@uma/sdk";
import { calcGcr } from "./utils";
import assert from "assert";
import bluebird from "bluebird";

export default (appState: AppState) => {
  async function getAnyEmp(empAddress: string) {
    if (await appState.emps.active.has(empAddress)) {
      return appState.emps.active.get(empAddress);
    }
    return appState.emps.expired.get(empAddress);
  }
  // joins emp with token state and gcr
  async function getFullEmpState(empState: uma.tables.emps.Data) {
    assert(empState.tokenCurrency, "requires tokenCurrency");
    assert(empState.collateralCurrency, "requires collateralCurrency");
    const token = await appState.erc20s.get(empState.tokenCurrency);
    const collateral = await appState.erc20s.get(empState.collateralCurrency);

    const state = {
      ...empState,
      tokenDecimals: token?.decimals,
      collateralDecimals: collateral?.decimals,
      tokenName: token?.name,
      collateralName: collateral?.name,
    };
    const gcr = calcGcr(state).toString();
    return {
      ...state,
      gcr,
    };
  }

  async function listActiveEmps() {
    const emps = appState.emps.active.values();
    return bluebird.map(emps, (emp) => getFullEmpState(emp).catch(() => emp));
  }
  async function listExpiredEmps() {
    const emps = appState.emps.expired.values();
    return bluebird.map(emps, (emp) => getFullEmpState(emp).catch(() => emp));
  }

  return {
    getFullEmpState,
    getAnyEmp,
    listActiveEmps,
    listExpiredEmps,
  };
};
