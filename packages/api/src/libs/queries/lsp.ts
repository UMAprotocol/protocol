import assert from "assert";
import bluebird from "bluebird";
import { BigNumber } from "ethers";

import * as tables from "../../tables";
import type { AppState, CurrencySymbol } from "../..";

type Dependencies = Pick<AppState, "erc20s" | "stats" | "lsps" | "registeredLsps">;

export default (appState: Dependencies) => {
  const { lsps, erc20s } = appState;

  async function hasAddress(address: string) {
    return (await lsps.active.has(address)) || (await lsps.expired.has(address));
  }
  async function getAny(address: string) {
    if (await lsps.active.has(address)) {
      return lsps.active.get(address);
    }
    if (await lsps.expired.has(address)) {
      return lsps.expired.get(address);
    }
    throw new Error("LSP not found by address: " + address);
  }
  function getTvl(address: string, currency: CurrencySymbol = "usd") {
    assert(appState.stats.lsp[currency], "invalid currency: " + currency);
    return appState.stats.lsp["usd"].latest.tvl.get(address);
  }
  async function getFullState(state: tables.lsps.Data) {
    const collateralState = state.collateralToken ? await erc20s.get(state.collateralToken).catch(() => null) : null;
    const longTokenState = state.longToken ? await erc20s.get(state.longToken).catch(() => null) : null;
    const shortTokenState = state.shortToken ? await erc20s.get(state.shortToken).catch(() => null) : null;
    const tvl = await getTvl(state.address)
      .then((sample) => sample.value)
      .catch(() => null);
    return {
      ...state,
      longTokenDecimals: longTokenState?.decimals,
      shortTokenDecimals: shortTokenState?.decimals,
      collateralDecimals: collateralState?.decimals,
      longTokenName: longTokenState?.name,
      shortTokenName: shortTokenState?.name,
      collateralName: collateralState?.name,
      longTokenSymbol: longTokenState?.symbol,
      shortTokenSymbol: shortTokenState?.symbol,
      collateralSymbol: collateralState?.symbol,
      tvl,
      type: "lsp",
    };
  }
  async function listActive() {
    const list = await lsps.active.values();
    return bluebird.map(list, (el) => getFullState(el).catch(() => el));
  }
  async function listExpired() {
    const list = await lsps.expired.values();
    return bluebird.map(list, (el) => getFullState(el).catch(() => el));
  }
  async function sumTvl(addresses: string[], currency: CurrencySymbol = "usd") {
    const tvls = await Promise.all(
      addresses.map(async (address) => {
        try {
          const stat = await appState.stats.lsp[currency].latest.tvl.get(address);
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
    const addresses = Array.from(appState.registeredLsps);
    return sumTvl(addresses, currency);
  }

  async function getTotalTvlSample(currency: CurrencySymbol = "usd") {
    assert(appState.stats.lsp[currency], "Invalid currency: " + currency);
    return appState.stats.lsp[currency].latest.tvl.getGlobal();
  }
  async function getTotalTvl(currency: CurrencySymbol = "usd") {
    const result = await getTotalTvlSample(currency);
    return result.value;
  }
  return {
    getFullState,
    getAny,
    listExpired,
    listActive,
    totalTvl,
    sumTvl,
    getTotalTvl,
    getTotalTvlSample,
    hasAddress,
  };
};
