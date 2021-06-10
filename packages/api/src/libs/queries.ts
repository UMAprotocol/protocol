// allow for more complex queries, joins and shared queries between services
import { Libs } from "..";
import uma from "@uma/sdk";
import { calcGcr } from "./utils";
import assert from "assert";
import bluebird from "bluebird";

export default (libs: Libs) => {
  async function getAnyEmp(empAddress: string) {
    if (await libs.emps.active.has(empAddress)) {
      return libs.emps.active.get(empAddress);
    }
    return libs.emps.expired.get(empAddress);
  }
  // joins emp with token state and gcr
  async function getFullEmpState(empState: uma.tables.emps.Data) {
    assert(empState.tokenCurrency, "requires tokenCurrency");
    assert(empState.collateralCurrency, "requires collateralCurrency");
    const token = await libs.erc20s.get(empState.tokenCurrency);
    const collateral = await libs.erc20s.get(empState.collateralCurrency);

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
    const emps = libs.emps.active.values();
    return bluebird.map(emps, (emp) => getFullEmpState(emp).catch(() => emp));
  }
  async function listExpiredEmps() {
    const emps = libs.emps.expired.values();
    return bluebird.map(emps, (emp) => getFullEmpState(emp).catch(() => emp));
  }

  return {
    getFullEmpState,
    getAnyEmp,
    listActiveEmps,
    listExpiredEmps,
  };
};
