import assert from "assert";
import { ethers } from "ethers";
import moment from "moment";

import { tables, Coingecko, utils, Multicall } from "@uma/sdk";

import * as Services from "../../services";
import Express from "../../services/express-channels";
import * as Actions from "../../services/actions";
import { ProcessEnv, AppState, Channels } from "../..";
import { empStats, empStatsHistory, lsps } from "../../tables";
import Zrx from "../../libs/zrx";
import { Profile, parseEnvArray, getWeb3, BlockInterval, expirePromise } from "../../libs/utils";

export default async (env: ProcessEnv) => {
  assert(env.CUSTOM_NODE_URL, "requires CUSTOM_NODE_URL");
  assert(env.EXPRESS_PORT, "requires EXPRESS_PORT");
  assert(env.zrxBaseUrl, "requires zrxBaseUrl");
  assert(env.MULTI_CALL_ADDRESS, "requires MULTI_CALL_ADDRESS");
  const lspCreatorAddresses = parseEnvArray(env.lspCreatorAddresses || "");

  // debug flag for more verbose logs
  const debug = Boolean(env.debug);
  const profile = Profile(debug);

  const provider = new ethers.providers.WebSocketProvider(env.CUSTOM_NODE_URL);

  // we need web3 for syth price feeds
  const web3 = getWeb3(env.CUSTOM_NODE_URL);

  // how often to run expensive state updates, defaults to 10 minutes
  const updateRateS = Number(env.UPDATE_RATE_S || 10 * 60);
  // Defaults to 60 seconds, since this is i think a pretty cheap call, and we want to see new contracts quickly
  const detectContractsUpdateRateS = Number(env.DETECT_CONTRACTS_UPDATE_RATE_S || 60);
  // Defaults to 15 minutes, prices dont update in coingecko or other calls very fast
  const priceUpdateRateS = Number(env.PRICE_UPDATE_RATE_S || 15 * 60);
  // default to 10 days worth of blocks
  const oldestBlock = Number(env.OLDEST_BLOCK_MS || 10 * 60 * 60 * 24 * 1000);

  assert(updateRateS >= 1, "UPDATE_RATE_S must be 1 or higher");
  assert(detectContractsUpdateRateS >= 1, "DETECT_CONTRACTS_UPDATE_RATE_S must be 1 or higher");
  assert(priceUpdateRateS >= 1, "PRICE_UPDATE_RATE_S must be 1 or higher");

  // state shared between services
  const appState: AppState = {
    provider,
    web3,
    coingecko: new Coingecko(),
    zrx: new Zrx(env.zrxBaseUrl),
    blocks: tables.blocks.JsMap(),
    emps: {
      active: tables.emps.JsMap("Active Emp"),
      expired: tables.emps.JsMap("Expired Emp"),
    },
    prices: {
      usd: {
        latest: {},
        history: {},
      },
    },
    synthPrices: {
      latest: {},
      history: {},
    },
    marketPrices: {
      usdc: {
        latest: {},
        history: empStatsHistory.SortedJsMap("Market Price"),
      },
    },
    erc20s: tables.erc20s.JsMap(),
    stats: {
      emp: {
        usd: {
          latest: {
            tvm: empStats.JsMap("Latest Tvm"),
            tvl: empStats.JsMap("Latest Tvl"),
          },
          history: {
            tvm: empStatsHistory.SortedJsMap("Tvm History"),
            tvl: empStatsHistory.SortedJsMap("Tvl History"),
          },
        },
      },
      lsp: {
        usd: {
          latest: {
            tvl: empStats.JsMap("Latest Tvl"),
            tvm: empStats.JsMap("Latest Tvm"),
          },
          history: {
            tvl: empStatsHistory.SortedJsMap("Tvl History"),
          },
        },
      },
      global: {
        usd: {
          latest: {
            tvl: [0, "0"],
          },
          history: {
            tvl: empStatsHistory.SortedJsMap("Tvl Global History"),
          },
        },
      },
    },
    lastBlockUpdate: 0,
    registeredEmps: new Set<string>(),
    registeredEmpsMetadata: new Map(),
    registeredLsps: new Set<string>(),
    registeredLspsMetadata: new Map(),
    collateralAddresses: new Set<string>(),
    syntheticAddresses: new Set<string>(),
    // lsp related props. could be its own state object
    longAddresses: new Set<string>(),
    shortAddresses: new Set<string>(),
    multicall: new Multicall(env.MULTI_CALL_ADDRESS, provider),
    lsps: {
      active: lsps.JsMap("Active LSP"),
      expired: lsps.JsMap("Expired LSP"),
    },
  };

  // services for ingesting data
  const services = {
    // these services can optionally be configured with a config object, but currently they are undefined or have defaults
    blocks: Services.Blocks(undefined, appState),
    emps: Services.EmpState({ debug }, appState),
    registry: await Services.Registry({ debug }, appState),
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

  const initBlock = await provider.getBlock("latest");

  // warm caches
  await services.registry(appState.lastBlockUpdate, initBlock.number);
  console.log("Got all EMP addresses");

  await services.lspCreator.update(appState.lastBlockUpdate, initBlock.number);
  console.log("Got all LSP addresses");

  await services.emps(appState.lastBlockUpdate, initBlock.number);
  console.log("Updated EMP state");

  await services.lsps.update(appState.lastBlockUpdate, initBlock.number);
  console.log("Updated LSP state");

  // we've update our state based on latest block we queried
  appState.lastBlockUpdate = initBlock.number;

  await services.erc20s.update();
  console.log("Updated tokens");

  // backfill price histories, disable if not specified in env
  if (env.backfillDays) {
    console.log(`Backfilling price history from ${env.backfillDays} days ago`);
    await services.collateralPrices.backfill(moment().subtract(env.backfillDays, "days").valueOf());
    console.log("Updated Collateral Prices Backfill");
    await services.empStats.backfill();
    console.log("Updated EMP Backfill");

    await services.lspStats.backfill();
    console.log("Updated LSP Backfill");
  }

  await services.collateralPrices.update();
  console.log("Updated Collateral Prices");

  await services.syntheticPrices.update();
  console.log("Updated Synthetic Prices");

  await services.empStats.update();
  console.log("Updated EMP Stats");

  await services.lspStats.update();
  console.log("Updated LSP Stats");

  await services.globalStats.update();
  console.log("Updated Global Stats");

  await services.marketPrices.update();
  console.log("Updated Market Prices");

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

  await Express({ port: Number(env.EXPRESS_PORT), debug }, channels)();
  console.log("Started Express Server, API accessible");

  async function detectNewContracts(startBlock: number, endBlock: number) {
    await services.registry(startBlock, endBlock);
    await services.lspCreator.update(startBlock, endBlock);
  }

  // break all state updates by block events into a cleaner function
  async function updateContractState(startBlock: number, endBlock: number) {
    await services.blocks.handleNewBlock(endBlock);
    // update everyting
    await services.emps(startBlock, endBlock);
    await services.lsps.update(startBlock, endBlock);
    await services.erc20s.update();
    await services.blocks.cleanBlocks(oldestBlock);
    appState.lastBlockUpdate = endBlock;
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

  // wait update rate before running loops, since all state was just updated on init
  await new Promise((res) => setTimeout(res, updateRateS * 1000));

  console.log("Starting API update loops");

  async function getLatestBlockNumber() {
    const block = await provider.getBlock("latest");
    return block.number;
  }

  const newContractBlockTick = BlockInterval(detectNewContracts, initBlock.number);
  const updateContractStateTick = BlockInterval(updateContractState, initBlock.number);

  // detect contract loop
  utils.loop(async () => {
    const end = profile("Detecting New Contracts");
    // adding in a timeout rejection if the update takes too long
    await expirePromise(
      async () => {
        const { startBlock, endBlock } = await newContractBlockTick(await getLatestBlockNumber());
        console.log("Checked for new contracts between blocks", startBlock, endBlock);
        // error out if this fails to complete in 5 minutes
      },
      5 * 60 * 1000,
      "Detecting new contracts timed out"
    )
      .catch(console.error)
      .finally(end);
  }, detectContractsUpdateRateS * 1000);

  // main update loop for all state, executes immediately and waits for updateRateS
  utils.loop(async () => {
    const end = profile("Running contract state updates");
    // adding in a timeout rejection if the update takes too long
    await expirePromise(
      async () => {
        const { startBlock, endBlock } = await updateContractStateTick(await getLatestBlockNumber());
        console.log("Updated Contract state between blocks", startBlock, endBlock);
        // throw an error if this fails to process in 15 minutes
      },
      15 * 60 * 1000,
      "Contract state updates timed out"
    )
      .catch(console.error)
      .finally(end);
  }, updateRateS * 1000);

  // coingeckos prices don't update very fast, so set it on an interval every few minutes
  utils.loop(async () => {
    const end = profile("Update all prices");
    await updatePrices().catch(console.error).finally(end);
  }, priceUpdateRateS * 1000);
};
