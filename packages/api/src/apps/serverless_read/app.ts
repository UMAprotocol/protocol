import assert from "assert";
import { tables } from "@uma/sdk";
import { Datastore } from "@google-cloud/datastore";

import Express from "../../services/express-channels";
import * as Actions from "../../services/actions";
import {
  addresses,
  appStats,
  empStats,
  empStatsHistory,
  lsps,
  priceSamples,
  registeredContracts,
  StoresFactory,
  tvl,
} from "../../tables";

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
    prices: {
      usd: {
        latest: priceSamples.Table("Latest Usd Prices", datastores.latestUsdPrices),
        history: {},
      },
    },
    synthPrices: {
      latest: priceSamples.Table("Latest Synth Prices", datastores.latestSynthPrices),
      history: {},
    },
    marketPrices: {
      usdc: {
        latest: priceSamples.Table("Latest USDC Market Prices", datastores.latestUsdcMarketPrices),
        history: empStatsHistory.Table("Market Price", datastores.empStatsHistory),
      },
    },
    erc20s: tables.erc20s.Table("Erc20", datastores.erc20),
    stats: {
      emp: {
        usd: {
          latest: {
            tvm: empStats.Table("Latest Tvm", datastores.empStatsTvm),
            tvl: empStats.Table("Latest Tvl", datastores.empStatsTvl),
          },
          history: {
            tvm: empStatsHistory.Table("Tvm History", datastores.empStatsTvlHistory),
            tvl: empStatsHistory.Table("Tvl History", datastores.empStatsTvmHistory),
          },
        },
      },
      lsp: {
        usd: {
          latest: {
            tvl: empStats.Table("Latest Tvl", datastores.lspStatsTvl),
            tvm: empStats.Table("Latest Tvm", datastores.lspStatsTvm),
          },
          history: {
            tvl: empStatsHistory.Table("Tvl History", datastores.lspStatsTvlHistory),
          },
        },
      },
      global: {
        usd: {
          latest: {
            tvl: tvl.Table("Latest Usd Global Tvl", datastores.globalUsdLatestTvl),
          },
          history: {
            tvl: empStatsHistory.Table("Tvl Global History"),
          },
        },
      },
    },
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
