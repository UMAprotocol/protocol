import type uma from "@uma/sdk";
import type { ethers } from "ethers";
import type { empStats, empStatsHistory, lsps, appStats, registeredEmps } from "./tables";
import type Zrx from "./libs/zrx";
export type { Channels } from "./services/express-channels";

export type EmpState = uma.tables.emps.Data;
export type LspState = lsps.Data;
export type AllContractStates = EmpState | LspState;

export interface BaseConfig {
  debug?: boolean;
}
export type Currencies = "usd";
export type { BigNumber } from "ethers";
export type Provider = ethers.providers.Provider;
export type ProcessEnv = {
  [key: string]: string | undefined;
};
import type Web3 from "web3";
export type Obj = { [key: string]: any };
// serializable json type
export type Json = null | undefined | void | boolean | number | string | Json[] | { [prop: string]: Json };

// Represents an function where inputs and outputs can serialize to/from json
export type Action = (...args: any[]) => Json | Promise<Json>;
export type Actions = { [key: string]: Action };

// this represents valid currencies to check prices against on coingecko
// see: https://www.coingecko.com/api/documentations/v3#/asset_platforms/get_asset_platforms
export type CurrencySymbol = "usd";
export type PriceSample = [timestamp: number, price: string];
// These are library dependencies to all services
export type AppState = {
  coingecko: uma.Coingecko;
  zrx: Zrx;
  emps: {
    active: uma.tables.emps.Table;
    expired: uma.tables.emps.Table;
  };
  lsps: {
    active: lsps.Table;
    expired: lsps.Table;
  };
  prices: {
    usd: {
      latest: {
        [key: string]: PriceSample;
      };
      history: {
        [key: string]: uma.tables.historicalPrices.Table;
      };
    };
  };
  synthPrices: {
    latest: {
      [empAddress: string]: PriceSample;
    };
    history: {
      [empAddress: string]: uma.tables.historicalPrices.Table;
    };
  };
  marketPrices: {
    // note this is in usdc since these are fetched from amms using usdc as the quote currency
    usdc: {
      latest: { [tokenAddress: string]: PriceSample };
      history: empStatsHistory.Table;
    };
  };
  erc20s: uma.tables.erc20s.Table;
  stats: {
    emp: {
      usd: {
        latest: {
          tvl: empStats.Table;
          tvm: empStats.Table;
        };
        history: {
          tvl: empStatsHistory.Table;
          tvm: empStatsHistory.Table;
        };
      };
    };
    lsp: {
      usd: {
        latest: {
          tvl: empStats.Table;
          tvm: empStats.Table;
        };
        history: {
          tvl: empStatsHistory.Table;
        };
      };
    };
    global: {
      usd: {
        latest: {
          tvl: PriceSample;
        };
        history: {
          tvl: empStatsHistory.Table;
        };
      };
    };
  };
  registeredEmps: registeredEmps.Table;
  registeredEmpsMetadata: Map<string, { blockNumber: number }>;
  registeredLsps: Set<string>;
  registeredLspsMetadata: Map<string, { blockNumber: number }>;
  provider: Provider;
  web3: Web3;
  lastBlockUpdate: number;
  collateralAddresses: Set<string>;
  syntheticAddresses: Set<string>;
  longAddresses: Set<string>;
  shortAddresses: Set<string>;
  multicall2: uma.Multicall2;
};

export type DatastoreAppState = AppState & {
  appStats: appStats.Table;
};
