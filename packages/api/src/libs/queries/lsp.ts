import assert from "assert";
import bluebird from "bluebird";
import { BigNumber } from "ethers";

import * as tables from "../../tables";
import type { AppState, CurrencySymbol } from "../../types";

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
  function getTvm(address: string, currency: CurrencySymbol = "usd") {
    assert(appState.stats.lsp[currency], "invalid currency: " + currency);
    return appState.stats.lsp["usd"].latest.tvm.get(address);
  }
  async function getFullState(state: tables.lsps.Data) {
    const collateralState = state.collateralToken ? await erc20s.get(state.collateralToken).catch(() => null) : null;
    const longTokenState = state.longToken ? await erc20s.get(state.longToken).catch(() => null) : null;
    const shortTokenState = state.shortToken ? await erc20s.get(state.shortToken).catch(() => null) : null;
    const tvl = await getTvl(state.address)
      .then((sample) => sample.value)
      .catch(() => null);
    const tvm = await getTvm(state.address)
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
      tvm,
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
          const stat = await getTvl(address, currency);
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
    const addresses = await appState.registeredLsps.keys();
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
  // tvm calculations, these are just based on tvl
  async function sumTvm(addresses: string[], currency: CurrencySymbol = "usd") {
    const tvms = await Promise.all(
      addresses.map(async (address) => {
        try {
          const stat = await getTvm(address, currency);
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
    const addresses = await appState.registeredLsps.keys();
    return sumTvm(addresses, currency);
  }
  async function getTotalTvmSample(currency: CurrencySymbol = "usd") {
    assert(appState.stats.lsp[currency], "Invalid currency: " + currency);
    return appState.stats.lsp[currency].latest.tvm.getGlobal();
  }
  async function getTotalTvm(currency: CurrencySymbol = "usd") {
    const result = await getTotalTvmSample(currency);
    return result.value;
  }
  return {
    getFullState,
    getAny,
    listExpired,
    listActive,
    totalTvl,
    totalTvm,
    sumTvl,
    sumTvm,
    getTotalTvl,
    getTotalTvm,
    getTotalTvlSample,
    getTotalTvmSample,
    hasAddress,
    getTvm,
    getTvl,
  };
};
