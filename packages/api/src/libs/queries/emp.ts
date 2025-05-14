// allow for more complex queries, joins and shared queries between services
import * as uma from "@uma/sdk";
import bluebird from "bluebird";
import type { AppState } from "../../types";

type Dependencies = Pick<AppState, "erc20s" | "emps" | "registeredEmps">;

export default (appState: Dependencies) => {
  async function hasAddress(address: string) {
    return (await appState.emps.active.has(address)) || (await appState.emps.expired.has(address));
  }
  async function getAny(empAddress: string) {
    if (await appState.emps.active.has(empAddress)) {
      return appState.emps.active.get(empAddress);
    }
    if (await appState.emps.expired.has(empAddress)) {
      return appState.emps.expired.get(empAddress);
    }
    throw new Error("Unable to find EMP with address: " + empAddress);
  }
  // joins emp with token state and gcr
  async function getFullState(empState: uma.tables.emps.Data) {
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
      tokenSymbol: token?.symbol,
      collateralSymbol: collateral?.symbol,
      type: "emp",
    };
    return {
      ...state,
    };
  }

  async function listActive() {
    const emps = appState.emps.active.values();
    return bluebird.map(emps, (emp) => getFullState(emp).catch(() => emp));
  }
  async function listExpired() {
    const emps = appState.emps.expired.values();
    return bluebird.map(emps, (emp) => getFullState(emp).catch(() => emp));
  }
  return {
    getFullState,
    getAny,
    listActive,
    listExpired,
    hasAddress,
  };
};
