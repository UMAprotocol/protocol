import assert from "assert";
// allow for more complex queries, joins and shared queries between services
import * as uma from "@uma/sdk";
import { calcGcr } from "../utils";
import bluebird from "bluebird";
import { BigNumber, utils } from "ethers";
import type { AppState, CurrencySymbol, PriceSample } from "../../types";

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
    const priceSample = await prices[currency].latest.get(address);
    assert(exists(priceSample), "No price for address: " + address);
    return priceSample;
  }
  async function getLatestIdentifierPrice(empAddress: string) {
    const synthPrice = await synthPrices.latest.get(empAddress);
    assert(synthPrice, "No identifier price for emp address: " + empAddress);
    // [timestamp, price], returns just price
    return synthPrice.price;
  }
  async function getLatestMarketPrice(address: string, currency: "usdc" = "usdc") {
    assert(address, "requires an erc20 token address");
    assert(exists(marketPrices[currency]), "invalid currency type: " + currency);
    const priceSample = await marketPrices[currency].latest.get(address);
    assert(exists(priceSample), "No price for address: " + address);
    return priceSample.price;
  }
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
  function getTvl(address: string, currency: CurrencySymbol = "usd") {
    assert(appState.stats.emp[currency], "invalid currency: " + currency);
    return appState.stats.emp[currency].latest.tvl.get(address);
  }
  function getTvm(address: string, currency: CurrencySymbol = "usd") {
    assert(appState.stats.emp[currency], "invalid currency: " + currency);
    return appState.stats.emp[currency].latest.tvm.get(address);
  }
  // joins emp with token state and gcr
  async function getFullState(empState: uma.tables.emps.Data) {
    const token = empState.tokenCurrency ? await appState.erc20s.get(empState.tokenCurrency).catch(() => null) : null;
    const collateral = empState.collateralCurrency
      ? await appState.erc20s.get(empState.collateralCurrency).catch(() => null)
      : null;

    const tokenMarketPrice = empState.tokenCurrency
      ? await getLatestMarketPrice(empState.tokenCurrency).catch(() => null)
      : null;

    const tvl = await getTvl(empState.address)
      .then((sample) => sample.value)
      .catch(() => null);
    const tvm = await getTvm(empState.address)
      .then((sample) => sample.value)
      .catch(() => null);

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
      tvl,
      tvm,
      type: "emp",
    };
    // raw gcr is just the collateral divided by tokens outstanding
    let gcrRaw = "0";
    try {
      gcrRaw = calcGcr(state).toString();
    } catch (err) {
      // nothing
    }
    // gcr now also takes into consideration the identifier price, defaults to raw if anything happens
    let gcr = gcrRaw;
    try {
      gcr = utils
        .parseUnits(gcrRaw)
        // if theres no identifier price, just divide by 1
        .div(state.identifierPrice || utils.parseUnits("1"))
        .toString();
    } catch (err) {
      // nothing
    }
    return {
      ...state,
      gcrRaw,
      gcr,
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
  async function sumTvl(addresses: string[], currency: CurrencySymbol = "usd") {
    const tvls = await Promise.all(
      addresses.map(async (address) => {
        try {
          const stat = await appState.stats.emp[currency].latest.tvl.get(address);
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
    const addresses = await appState.registeredEmps.keys();
    return sumTvl(addresses, currency);
  }
  async function sumTvm(addresses: string[], currency: CurrencySymbol = "usd") {
    const tvms = await Promise.all(
      addresses.map(async (address) => {
        try {
          const stat = await appState.stats.emp[currency].latest.tvm.get(address);
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
    const addresses = await appState.registeredEmps.keys();
    return sumTvm(addresses, currency);
  }
  async function getTotalTvlSample(currency: CurrencySymbol = "usd") {
    assert(appState.stats.emp[currency], "Invalid currency: " + currency);
    return appState.stats.emp[currency].latest.tvl.getGlobal();
  }
  async function getTotalTvl(currency: CurrencySymbol = "usd") {
    const result = await getTotalTvlSample(currency);
    return result.value;
  }

  return {
    getFullState,
    getAny,
    listActive,
    listExpired,
    totalTvl,
    sumTvl,
    totalTvm,
    sumTvm,
    latestPriceByTokenAddress,
    historicalPricesByTokenAddress,
    sliceHistoricalPricesByTokenAddress,
    getTotalTvl,
    getTotalTvlSample,
    hasAddress,
  };
};
