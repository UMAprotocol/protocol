import type uma from "@uma/sdk";
import type { ethers } from "ethers";
import type {
  // empStats,
  // empStatsHistory,
  lsps,
  appStats,
  registeredContracts,
  addresses,
  // priceSamples,
  // tvl,
} from "./tables";
import type Zrx from "./libs/zrx";
import type * as services from "./services";

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
export type ActionCall = (action: string, ...args: Json[]) => Promise<Json>;

// this represents valid currencies to check prices against on coingecko
// see: https://www.coingecko.com/api/documentations/v3#/asset_platforms/get_asset_platforms
export type CurrencySymbol = "usd";
export type PriceSample = [timestamp: number, price: string];
// These are library dependencies to all services
export type AppState = {
  emps: {
    active: uma.tables.emps.Table;
    expired: uma.tables.emps.Table;
  };
  lsps: {
    active: lsps.Table;
    expired: lsps.Table;
  };
  erc20s: uma.tables.erc20s.Table;
  registeredEmps: registeredContracts.Table;
  registeredLsps: registeredContracts.Table;
  collateralAddresses: addresses.Table;
  syntheticAddresses: addresses.Table;
  longAddresses: addresses.Table;
  shortAddresses: addresses.Table;
  appStats: appStats.Table;
};

export type AppClients = {
  coingecko: uma.Coingecko;
  zrx: Zrx;
  multicall2: uma.Multicall2;
  provider: Provider;
  web3: Web3;
};

export type AppServices = {
  registry: services.Registry;
  lspCreator: services.LspCreator;
  emps: services.EmpState;
  lsps: services.LspState;
  erc20s: services.Erc20s;
};

export type OrchestratorServices = {
  contracts: services.Contracts;
};

export type ChainId = number;
export const CHAIN_IDs = {
  mainnet: 1,
  polygon_matic: 137,
};
