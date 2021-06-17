import assert from "assert";
import * as uma from "@uma/sdk";
export { BigNumber, utils } from "ethers";
import { Currencies, AppState, PriceSample } from "..";
import { calcTvl } from "../libs/utils";
import Queries from "../libs/queries";
type Config = {
  currency?: Currencies;
};
type Dependencies = Pick<AppState, "emps" | "stats" | "prices" | "erc20s">;

// this service is meant to calculate numbers derived from emp state, things like TVL, TVM and other things
export default (config: Config, appState: Dependencies) => {
  const { emps, stats, prices } = appState;
  const { currency = "usd" } = config;

  const queries = Queries(appState);
  async function updateTvl(address: string) {
    const emp = await queries.getAnyEmp(address);
    // the full state has collateral decimals, pulled from erc20 state
    const fullState = await queries.getFullEmpState(emp);

    assert(uma.utils.exists(fullState.collateralCurrency), "Emp requires collateralCurrency: " + address);

    // PriceSample is type [ timestamp:number, price:string]
    const priceSample: PriceSample = prices[currency].latest[fullState.collateralCurrency];
    assert(uma.utils.exists(priceSample), "No latest price found for emp: " + address);

    const price = priceSample[1];
    assert(uma.utils.exists(price), "Invalid latest price found on emp: " + address);

    const tvl = calcTvl(price, fullState).toString();
    return stats[currency].latest.upsert(address, { tvl });
  }

  // update all tvl but do not let errors block other addresses from updating
  async function updateTvls(addresses: string[]) {
    // this call can easily error, but we dont want that to prevent all emps to resolve
    // also since this is just calling our db or cache we can use promise.allSettled for speed
    return Promise.allSettled(addresses.map(updateTvl));
  }

  async function update() {
    const addresses = [...(await emps.active.keys()), ...(await emps.expired.keys())];
    await updateTvls(addresses).then((results) => {
      results.forEach((result) => {
        if (result.status === "rejected") console.error("Error updating TVL: " + result.reason.message);
      });
    });
  }

  return {
    update,
    utils: {
      updateTvl,
      updateTvls,
    },
  };
};
