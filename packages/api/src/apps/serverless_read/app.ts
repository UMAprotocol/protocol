import assert from "assert";
import { tables } from "@uma/sdk";
import { Datastore } from "@google-cloud/datastore";

import Express from "../../services/express-channels";
import * as Actions from "../../services/actions";
import { addresses, appStats, lsps, registeredContracts, StoresFactory } from "../../tables";

import type { AppState, ProcessEnv, Channels } from "../../types";

export default async (env: ProcessEnv) => {
  assert(env.EXPRESS_PORT, "requires EXPRESS_PORT");

  // debug flag for more verbose logs
  const debug = Boolean(env.debug);
  const datastoreClient = new Datastore();
  const datastores = StoresFactory(datastoreClient);
  // state shared between services
  const appState: AppState = {
    emps: {
      active: tables.emps.Table("Active Emp", datastores.empsActive),
      expired: tables.emps.Table("Expired Emp", datastores.empsExpired),
    },
    erc20s: tables.erc20s.Table("Erc20", datastores.erc20),
    registeredEmps: registeredContracts.Table("Registered Emps", datastores.registeredEmps),
    registeredLsps: registeredContracts.Table("Registered Lsps", datastores.registeredLsps),
    collateralAddresses: addresses.Table("Collateral Addresses", datastores.collateralAddresses),
    syntheticAddresses: addresses.Table("Synthetic Addresses", datastores.syntheticAddresses),
    // lsp related props. could be its own state object
    longAddresses: addresses.Table("Long Addresses", datastores.longAddresses),
    shortAddresses: addresses.Table("Short Addresses", datastores.shortAddresses),
    lsps: {
      active: lsps.Table("Active LSP", datastores.lspsActive),
      expired: lsps.Table("Expired LSP", datastores.lspsExpired),
    },
    appStats: appStats.Table("App Stats", datastores.appStats),
  };

  // services consuming data
  const channels: Channels = [
    // set this as default channel for backward compatibility. This is deprecated and will eventually be used for global style queries
    ["", Actions.Emp(undefined, appState)],
    // Should switch all clients to explicit channels
    ["emp", Actions.Emp(undefined, appState)],
    ["lsp", Actions.Lsp(undefined, appState)],
    // TODO: switch this to root path once frontend is ready to transition
    ["global", Actions.Global(undefined, appState)],
  ];
  // it looks like we want to enable tenderly simulations, so we are goign to validate env and enable osnap route
  if (env.TENDERLY_USER || env.TENDERLY_PROJECT || env.TENDERLY_ACCESS_KEY) {
    channels.push(["osnap", Actions.Osnap()]);
    console.log("Enabled Tenderly Simulations for Osnap");
  }

  await Express({ port: Number(env.EXPRESS_PORT), debug }, channels)();
  console.log("Started Express Server, API accessible on port", env.EXPRESS_PORT);
};
