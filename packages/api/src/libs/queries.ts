// allow for more complex queries, joins and shared queries between services
import type { AppState } from "..";
import uma from "@uma/sdk";
import { calcGcr } from "./utils";
import bluebird from "bluebird";

type Dependencies = Pick<AppState, "erc20s" | "emps">;

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
