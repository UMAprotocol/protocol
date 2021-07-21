import assert from "assert";
// allow for more complex queries, joins and shared queries between services
import type { AppState, CurrencySymbol, PriceSample } from "..";
import * as uma from "@uma/sdk";
import { calcGcr } from "./utils";
import bluebird from "bluebird";
import { BigNumber } from "ethers";

type Config = {
  globalKey?: string;
};
const { exists } = uma.utils;
type Dependencies = Pick<
  AppState,
  "erc20s" | "emps" | "stats" | "registeredEmps" | "prices" | "synthPrices" | "marketPrices"
>;

export default (appState: Dependencies) => {
  const { prices, synthPrices, marketPrices } = appState;

  async function historicalPricesByTokenAddress(
    address: string,
    start = 0,
    end: number = Date.now(),
    currency: CurrencySymbol = "usd"
  ): Promise<PriceSample[]> {
    assert(start >= 0, "requires a start value >= 0");
    assert(exists(prices[currency]), "invalid currency type: " + currency);
    assert(exists(prices[currency].history[address]), "no prices for address" + address);
    const results = await prices[currency].history[address].betweenByTimestamp(start, end);
    // convert this to tuple to save bytes.
    return results.map(({ price, timestamp }) => [timestamp, price]);
  }

  async function sliceHistoricalPricesByTokenAddress(
    address: string,
    start = 0,
    length = 1,
    currency: CurrencySymbol = "usd"
  ): Promise<PriceSample[]> {
    assert(start >= 0, "requires a start value >= 0");
    assert(exists(prices[currency]), "invalid currency type: " + currency);
    assert(exists(prices[currency].history[address]), "no prices for address" + address);
    const results = await prices[currency].history[address].sliceByTimestamp(start, length);
    // convert this to tuple to save bytes.
    return results.map(({ price, timestamp }) => [timestamp, price]);
  }
  async function latestPriceByTokenAddress(address: string, currency: CurrencySymbol = "usd") {
    assert(address, "requires an erc20 token address");
    assert(exists(prices[currency]), "invalid currency type: " + currency);
    const priceSample = prices[currency].latest[address];
    assert(exists(priceSample), "No price for address: " + address);
    return priceSample;
  }
  async function getLatestIdentifierPrice(empAddress: string) {
    assert(synthPrices.latest[empAddress], "No identifier price for emp address: " + empAddress);
    // [timestamp, price], returns just price
    return synthPrices.latest[empAddress][1];
  }
  async function getLatestMarketPrice(address: string, currency: "usdc" = "usdc") {
    assert(address, "requires an erc20 token address");
    assert(exists(marketPrices[currency]), "invalid currency type: " + currency);
    const priceSample = marketPrices[currency].latest[address];
    assert(exists(priceSample), "No price for address: " + address);
    return priceSample[1];
  }
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

    const tokenMarketPrice = empState.tokenCurrency
      ? await getLatestMarketPrice(empState.tokenCurrency).catch(() => null)
      : null;

    const state = {
      ...empState,
      tokenDecimals: token?.decimals,
      collateralDecimals: collateral?.decimals,
      tokenName: token?.name,
      collateralName: collateral?.name,
      tokenSymbol: token?.symbol,
      collateralSymbol: collateral?.symbol,
      identifierPrice: await getLatestIdentifierPrice(empState.address).catch(() => null),
      tokenMarketPrice,
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

  async function sumTvl(addresses: string[], currency: CurrencySymbol = "usd") {
    const tvls = await Promise.all(
      addresses.map(async (address) => {
        try {
          const stat = await appState.stats[currency].latest.tvl.get(address);
          return stat.value || "0";
        } catch (err) {
          return "0";
        }
      })
    );

    const tvl = await tvls.reduce((sum, tvl) => {
      return sum.add(tvl);
    }, BigNumber.from("0"));

    return tvl.toString();
  }
  async function totalTvl(currency: CurrencySymbol = "usd") {
    const addresses = Array.from(appState.registeredEmps.values());
    return sumTvl(addresses, currency);
  }
  async function sumTvm(addresses: string[], currency: CurrencySymbol = "usd") {
    const tvms = await Promise.all(
      addresses.map(async (address) => {
        try {
          const stat = await appState.stats[currency].latest.tvm.get(address);
          return stat.value || "0";
        } catch (err) {
          return "0";
        }
      })
    );

    const tvm = await tvms.reduce((sum, tvm) => {
      return sum.add(tvm);
    }, BigNumber.from("0"));

    return tvm.toString();
  }
  async function totalTvm(currency: CurrencySymbol = "usd") {
    const addresses = Array.from(appState.registeredEmps.values());
    return sumTvm(addresses, currency);
  }
  async function getGlobalTvl(currency: CurrencySymbol = "usd") {
    assert(appState.stats[currency], "Invalid currency: " + currency);
    const { value } = await appState.stats[currency].latest.tvl.getGlobal();
    return value;
  }

  return {
    getFullEmpState,
    getAnyEmp,
    listActiveEmps,
    listExpiredEmps,
    totalTvl,
    sumTvl,
    totalTvm,
    sumTvm,
    latestPriceByTokenAddress,
    historicalPricesByTokenAddress,
    sliceHistoricalPricesByTokenAddress,
    getGlobalTvl,
  };
};
