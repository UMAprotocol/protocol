import assert from "assert";
import { ethers } from "ethers";
import moment from "moment";
import { tables, Coingecko, Multicall2 } from "@uma/sdk";
import { Datastore } from "@google-cloud/datastore";

import * as Services from "../../services";
import {
  addresses,
  appStats,
  empStats,
  empStatsHistory,
  lsps,
  priceSamples,
  registeredContracts,
  StoresFactory,
} from "../../tables";
import Zrx from "../../libs/zrx";
import { Profile, parseEnvArray, getWeb3, expirePromise } from "../../libs/utils";

import type { ProcessEnv, DatastoreAppState } from "../../types";

export default async (env: ProcessEnv) => {
  assert(env.CUSTOM_NODE_URL, "requires CUSTOM_NODE_URL");
  assert(env.zrxBaseUrl, "requires zrxBaseUrl");
  assert(env.MULTI_CALL_2_ADDRESS, "requires MULTI_CALL_2_ADDRESS");
  const lspCreatorAddresses = parseEnvArray(env.lspCreatorAddresses || "");

  // debug flag for more verbose logs
  const debug = Boolean(env.debug);
  const profile = Profile(debug);

  const provider = new ethers.providers.WebSocketProvider(env.CUSTOM_NODE_URL);

  // we need web3 for syth price feeds
  const web3 = getWeb3(env.CUSTOM_NODE_URL);

  const datastoreClient = new Datastore();
  const datastores = StoresFactory(datastoreClient);
  // state shared between services
  const appState: DatastoreAppState = {
    provider,
    web3,
    coingecko: new Coingecko(),
    zrx: new Zrx(env.zrxBaseUrl),
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
            tvl: [0, "0"],
          },
          history: {
            tvl: empStatsHistory.Table("Tvl Global History"),
          },
        },
      },
    },
    lastBlockUpdate: 0,
    registeredEmps: registeredContracts.Table("Registered Emps", datastores.registeredEmps),
    registeredLsps: registeredContracts.Table("Registered Lsps", datastores.registeredLsps),
    collateralAddresses: addresses.Table("Collateral Addresses", datastores.collateralAddresses),
    syntheticAddresses: addresses.Table("Synthetic Addresses", datastores.syntheticAddresses),
    // lsp related props. could be its own state object
    longAddresses: addresses.Table("Long Addresses", datastores.longAddresses),
    shortAddresses: addresses.Table("Short Addresses", datastores.shortAddresses),
    multicall2: new Multicall2(env.MULTI_CALL_2_ADDRESS, provider),
    lsps: {
      active: lsps.Table("Active LSP", datastores.lspsActive),
      expired: lsps.Table("Expired LSP", datastores.lspsExpired),
    },
    appStats: appStats.Table("App Stats", datastores.appStats),
  };

  // services for ingesting data
  const services = {
    // these services can optionally be configured with a config object, but currently they are undefined or have defaults
    emps: Services.EmpState({ debug }, appState),
    registry: await Services.Registry({ debug, registryAddress: env.EMP_REGISTRY_ADDRESS }, appState),
    collateralPrices: Services.CollateralPrices({ debug }, appState),
    syntheticPrices: Services.SyntheticPrices(
      {
        debug,
        cryptowatchApiKey: env.cryptowatchApiKey,
        tradermadeApiKey: env.tradermadeApiKey,
        quandlApiKey: env.quandlApiKey,
        defipulseApiKey: env.defipulseApiKey,
      },
      appState
    ),
    erc20s: Services.Erc20s({ debug }, appState),
    empStats: Services.stats.Emp({ debug }, appState),
    marketPrices: Services.MarketPrices({ debug }, appState),
    lspCreator: await Services.MultiLspCreator({ debug, addresses: lspCreatorAddresses }, appState),
    lsps: Services.LspState({ debug }, appState),
    lspStats: Services.stats.Lsp({ debug }, appState),
    globalStats: Services.stats.Global({ debug }, appState),
  };

  async function detectNewContracts(startBlock: number, endBlock: number) {
    // ignore case when startblock == endblock, this can happen when loop is run before a new block has changed
    if (startBlock === endBlock) return;
    assert(startBlock < endBlock, "Startblock must be lower than endBlock");
    await services.registry(startBlock, endBlock);
    await services.lspCreator.update(startBlock, endBlock);
  }

  // break all state updates by block events into a cleaner function
  async function updateContractState(startBlock: number, endBlock: number) {
    // ignore case when startblock == endblock, this can happen when loop is run before a new block has changed
    if (startBlock === endBlock) return;
    assert(startBlock < endBlock, "Startblock must be lower than endBlock");
    // update everyting
    await services.emps.update(startBlock, endBlock);
    await services.lsps.update(startBlock, endBlock);
    await services.erc20s.update();
    await appState.appStats.setLastBlockUpdate(endBlock);
  }

  // separate out price updates into a different loop to query every few minutes
  async function updatePrices() {
    await services.collateralPrices.update();
    await services.syntheticPrices.update();
    await services.marketPrices.update();
    await services.empStats.update();
    await services.lspStats.update();
    await services.globalStats.update();
  }

  async function getLatestBlockNumber() {
    const block = await provider.getBlock("latest");
    return block.number;
  }

  const lastBlockUpdate = (await appState.appStats.getLastBlockUpdate()) || 0;
  const lastBlock = await getLatestBlockNumber();

  async function detectContractsProfiled() {
    const end = profile("Detecting New Contracts");
    // adding in a timeout rejection if the update takes too long
    await expirePromise(
      async () => {
        await detectNewContracts(lastBlockUpdate, lastBlock);
        console.log("Checked for new contracts between blocks", lastBlockUpdate, lastBlock);
        // error out if this fails to complete in 5 minutes
      },
      5 * 60 * 1000,
      "Detecting new contracts timed out"
    )
      .catch(console.error)
      .finally(end);
  }

  async function updateContractsStateProfiled() {
    const end = profile("Running contract state updates");
    // adding in a timeout rejection if the update takes too long
    await expirePromise(
      async () => {
        await updateContractState(lastBlockUpdate, lastBlock);
        console.log("Updated Contract state between blocks", lastBlockUpdate, lastBlock);
        // throw an error if this fails to process in 15 minutes
      },
      15 * 60 * 1000,
      "Contract state updates timed out"
    )
      .catch(console.error)
      .finally(end);
  }

  async function updatePricesProfiled() {
    const end = profile("Update all prices");
    await updatePrices().catch(console.error).finally(end);
  }

  await detectContractsProfiled();
  await updateContractsStateProfiled();

  // backfill price histories, disable if not specified in env
  if (env.backfillDays && lastBlockUpdate === 0) {
    console.log(`Backfilling price history from ${env.backfillDays} days ago`);
    await services.collateralPrices.backfill(moment().subtract(env.backfillDays, "days").valueOf());
    console.log("Updated Collateral Prices Backfill");

    // backfill price history only if runs for the first time
    await services.empStats.backfill();
    console.log("Updated EMP Backfill");

    await services.lspStats.backfill();
    console.log("Updated LSP Backfill");
  }

  await updatePricesProfiled();

  // Send the SIGTERM signal to exit the application. This is a temporary
  // approach until an upcoming fix that will clear the timers which prevent the
  // process from exit
  process.kill(process.pid, "SIGTERM");
};
