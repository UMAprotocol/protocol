import assert from "assert";
import { tables, Coingecko, Multicall2 } from "@uma/sdk";
import { Datastore } from "@google-cloud/datastore";

import Express from "../../services/express-channels";
import * as Services from "../../services";
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
import Zrx from "../../libs/zrx";
import { Profile, parseEnvArray, getWeb3, getEthers } from "../../libs/utils";

import type { AppClients, AppServices, AppState, OrchestratorServices, ProcessEnv, Channels } from "../../types";

export default async (env: ProcessEnv) => {
  assert(env.CUSTOM_NODE_URL, "requires CUSTOM_NODE_URL");
  assert(env.zrxBaseUrl, "requires zrxBaseUrl");
  assert(env.MULTI_CALL_2_ADDRESS, "requires MULTI_CALL_2_ADDRESS");
  const lspCreatorAddresses = parseEnvArray(env.lspCreatorAddresses || "");

  // debug flag for more verbose logs
  const debug = Boolean(env.debug);
  const profile = Profile(debug);
  const provider = getEthers(env.CUSTOM_NODE_URL);
  // we need web3 for syth price feeds
  const web3 = getWeb3(env.CUSTOM_NODE_URL);
  const datastoreClient = new Datastore();
  const datastores = StoresFactory(datastoreClient);
  const networkChainId = env.NETWORK_CHAIN_ID ? parseInt(env.NETWORK_CHAIN_ID) : (await provider.getNetwork()).chainId;
  const detectContractsBatchSize = env.DETECT_CONTRACTS_BATCH_SIZE
    ? parseInt(env.DETECT_CONTRACTS_BATCH_SIZE)
    : undefined;
  const updateContractsBatchSize = env.UPDATE_CONTRACTS_BATCH_SIZE
    ? parseInt(env.UPDATE_CONTRACTS_BATCH_SIZE)
    : undefined;
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
  // clients shared between services
  const appClients: AppClients = {
    provider,
    web3,
    coingecko: new Coingecko(),
    zrx: new Zrx(env.zrxBaseUrl),
    multicall2: new Multicall2(env.MULTI_CALL_2_ADDRESS, provider),
  };
  // services for ingesting data
  const services: AppServices = {
    // these services can optionally be configured with a config object, but currently they are undefined or have defaults
    emps: Services.EmpState({ debug }, { tables: appState, appClients }),
    registry: await Services.Registry(
      { debug, registryAddress: env.EMP_REGISTRY_ADDRESS, network: networkChainId },
      { tables: appState, appClients }
    ),
    collateralPrices: Services.CollateralPrices({ debug, network: networkChainId }, { tables: appState, appClients }),
    syntheticPrices: Services.SyntheticPrices(
      {
        debug,
        cryptowatchApiKey: env.cryptowatchApiKey,
        tradermadeApiKey: env.tradermadeApiKey,
        quandlApiKey: env.quandlApiKey,
        defipulseApiKey: env.defipulseApiKey,
      },
      appState,
      appClients
    ),
    erc20s: Services.Erc20s({ debug }, { tables: appState, appClients }),
    empStats: Services.stats.Emp({ debug }, appState),
    marketPrices: Services.MarketPrices({ debug }, { tables: appState, appClients }),
    lspCreator: await Services.MultiLspCreator(
      { debug, addresses: lspCreatorAddresses, network: networkChainId },
      { tables: appState, appClients }
    ),
    lsps: Services.LspState({ debug }, { tables: appState, appClients }),
    lspStats: Services.stats.Lsp({ debug }, appState),
    globalStats: Services.stats.Global({ debug }, appState),
  };

  // Orchestrator services are services that coordinate and aggregate other services
  const orchestratorServices: OrchestratorServices = {
    contracts: Services.Contracts(
      { debug, detectContractsBatchSize, updateContractsBatchSize },
      { tables: appState, profile, appClients, services }
    ),
    prices: Services.Prices(
      { backfillDays: parseInt(env.backfillDays || "") },
      { services, tables: appState, appClients, profile }
    ),
  };

  const channels: Channels = [
    ["scheduler", Actions.Scheduler(undefined, { tables: appState, services: orchestratorServices })],
  ];
  await Express({ port: Number(env.EXPRESS_PORT), debug }, channels)();
  console.log("Started Scheduler Express Server");
};
