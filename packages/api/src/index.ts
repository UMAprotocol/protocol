import uma from "@uma/sdk";
import { ethers } from "ethers";
export type { BigNumber } from "ethers";
export type Provider = ethers.providers.Provider;
export type ProcessEnv = {
  [key: string]: string | undefined;
};
export type Obj = { [key: string]: any };
// serializable json type
export type Json = null | undefined | boolean | number | string | Json[] | { [prop: string]: Json };

// Represents an function where inputs and outputs can serialize to/from json
export type Action = (...args: any[]) => Json | Promise<Json>;
export type Actions = { [key: string]: Action };

// this represents valid currencies to check prices against on coingecko
// see: https://www.coingecko.com/api/documentations/v3#/asset_platforms/get_asset_platforms
export type CurrencySymbol = "usd";
export type PriceSample = [timestamp: number, price: string];
// These are library dependencies to all services
export type Libs = {
  blocks: uma.tables.blocks.JsMap;
  coingecko: uma.Coingecko;
  emps: {
    active: uma.tables.emps.JsMap;
    expired: uma.tables.emps.JsMap;
  };
  prices: {
    usd: {
      latest: {
        [key: string]: PriceSample;
      };
      history: {
        [key: string]: uma.tables.historicalPrices.SortedJsMap;
      };
    };
  };
  erc20s: uma.tables.erc20s.JsMap;
  registeredEmps: Set<string>;
  provider: Provider;
  lastBlock: number;
  lastBlockUpdate: number;
  collateralAddresses: Set<string>;
  syntheticAddresses: Set<string>;
};
