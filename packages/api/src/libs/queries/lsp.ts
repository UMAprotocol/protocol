import bluebird from "bluebird";

import * as tables from "../../tables";
import type { AppState } from "../../types";

type Dependencies = Pick<AppState, "erc20s" | "lsps" | "registeredLsps">;

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
  async function getFullState(state: tables.lsps.Data) {
    const collateralState = state.collateralToken ? await erc20s.get(state.collateralToken).catch(() => null) : null;
    const longTokenState = state.longToken ? await erc20s.get(state.longToken).catch(() => null) : null;
    const shortTokenState = state.shortToken ? await erc20s.get(state.shortToken).catch(() => null) : null;
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
  return {
    getFullState,
    getAny,
    listExpired,
    listActive,
    hasAddress,
  };
};
