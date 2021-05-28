import * as uma from "@uma/sdk";
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

// These are library dependencies to all services
export type Libs = {
  blocks: uma.tables.blocks.JsMap;
  emps: {
    active: uma.tables.emps.JsMap;
    expired: uma.tables.emps.JsMap;
  };
  registeredEmps: Set<string>;
  provider: Provider;
  lastBlock: number;
  lastBlockUpdate: number;
};
