import assert from "assert";
import { ethers } from "ethers";
import Events from "events";
import Web3 from "web3";

import { tables, Coingecko, utils, Multicall2 } from "@uma/sdk";

import * as Services from "../../services";
import Express from "../../services/express-channels";
import * as Actions from "../../services/actions";
import { ProcessEnv, AppState, Channels, AppClients } from "../../types";
import {
  addresses,
  appStats,
  empStats,
  empStatsHistory,
  lsps,
  priceSamples,
  registeredContracts,
  tvl,
} from "../../tables";
import Zrx from "../../libs/zrx";
import { Profile, parseEnvArray, BlockInterval, expirePromise } from "../../libs/utils";

// This is almost identical to api app, but removes some key services from starting up. Maintains ability to use
// api for LSP calls only. Express API maintains compatibility with original API but will not populate EMP data.
// Eventually much of the code in this file could be refactored to deduplicate a lot of the shared code with API
// but would require more tooling/thought around how to turn this into configuration rather than code.
export default async (env: ProcessEnv) => {
  assert(env.CUSTOM_NODE_URL, "requires CUSTOM_NODE_URL");
  assert(env.EXPRESS_PORT, "requires EXPRESS_PORT");
  assert(env.zrxBaseUrl, "requires zrxBaseUrl");
  assert(env.MULTI_CALL_2_ADDRESS, "requires MULTI_CALL_2_ADDRESS");
  const lspCreatorAddresses = parseEnvArray(env.lspCreatorAddresses || "");

  // debug flag for more verbose logs
  const debug = Boolean(env.debug);
  const profile = Profile(debug);

  const provider = new ethers.providers.WebSocketProvider(env.CUSTOM_NODE_URL);

  // how often to run expensive state updates, defaults to 1 minutes since EMP updates are gone
  const updateRateS = Number(env.UPDATE_RATE_S || 60);
  // Defaults to 60 seconds, since this is i think a pretty cheap call, and we want to see new contracts quickly
  const detectContractsUpdateRateS = Number(env.DETECT_CONTRACTS_UPDATE_RATE_S || 60);
  // Defaults to 15 minutes, prices dont update in coingecko or other calls very fast
  const priceUpdateRateS = Number(env.PRICE_UPDATE_RATE_S || 15 * 60);

  assert(updateRateS >= 1, "UPDATE_RATE_S must be 1 or higher");
  assert(detectContractsUpdateRateS >= 1, "DETECT_CONTRACTS_UPDATE_RATE_S must be 1 or higher");
  assert(priceUpdateRateS >= 1, "PRICE_UPDATE_RATE_S must be 1 or higher");

  // services can emit events when necessary, though for now any services that depend on events must be in same process
  const serviceEvents = new Events();
  const networkChainId = env.NETWORK_CHAIN_ID ? parseInt(env.NETWORK_CHAIN_ID) : (await provider.getNetwork()).chainId;
  // state shared between services
  const appState: AppState = {
    emps: {
      active: tables.emps.Table("Active Emp"),
      expired: tables.emps.Table("Expired Emp"),
    },
    prices: {
      usd: {
        latest: priceSamples.Table("Latest Usd Prices"),
        history: {},
      },
    },
    synthPrices: {
      latest: priceSamples.Table("Latest Synth Prices"),
      history: {},
    },
    marketPrices: {
      usdc: {
        latest: priceSamples.Table("Latest USDC Market Prices"),
        history: empStatsHistory.Table("Market Price"),
      },
    },
    erc20s: tables.erc20s.Table(),
    stats: {
      emp: {
        usd: {
          latest: {
            tvm: empStats.Table("Latest Tvm"),
            tvl: empStats.Table("Latest Tvl"),
          },
          history: {
            tvm: empStatsHistory.Table("Tvm History"),
            tvl: empStatsHistory.Table("Tvl History"),
          },
        },
      },
      lsp: {
        usd: {
          latest: {
            tvl: empStats.Table("Latest Tvl"),
            tvm: empStats.Table("Latest Tvm"),
          },
          history: {
            tvl: empStatsHistory.Table("Tvl History"),
          },
        },
      },
      global: {
        usd: {
          latest: {
            tvl: tvl.Table("Latest Usd Global Tvl"),
          },
          history: {
            tvl: empStatsHistory.Table("Tvl Global History"),
          },
        },
      },
    },
    registeredEmps: registeredContracts.Table("Registered Emps"),
    registeredLsps: registeredContracts.Table("Registered Lsps"),
    collateralAddresses: addresses.Table("Collateral Addresses"),
    syntheticAddresses: addresses.Table("Synthetic Addresses"),
    // lsp related props. could be its own state object
    longAddresses: addresses.Table("Long Addresses"),
    shortAddresses: addresses.Table("Short Addresses"),
    lsps: {
      active: lsps.Table("Active LSP"),
      expired: lsps.Table("Expired LSP"),
    },
    appStats: appStats.Table("App Stats"),
  };
  // clients shared between services
  const appClients: AppClients = {
    provider,
    // This isnt needed for the lsp app to run, but the type needs to conform to app state
    web3: {} as Web3,
    coingecko: new Coingecko(),
    zrx: new Zrx(env.zrxBaseUrl),
    multicall2: new Multicall2(env.MULTI_CALL_2_ADDRESS, provider),
  };
  // services for ingesting data
  const services = {
    // these services can optionally be configured with a config object, but currently they are undefined or have defaults
    emps: Services.EmpState({ debug }, { tables: appState, appClients }),
    registry: await Services.Registry(
      { debug, registryAddress: env.EMP_REGISTRY_ADDRESS, network: networkChainId },
      { tables: appState, appClients },
      (event, data) => serviceEvents.emit("empRegistry", event, data)
    ),
    collateralPrices: Services.CollateralPrices({ debug, network: networkChainId }, { tables: appState, appClients }),
    erc20s: Services.Erc20s({ debug }, { tables: appState, appClients }),
    empStats: Services.stats.Emp({ debug }, appState),
    marketPrices: Services.MarketPrices({ debug }, { tables: appState, appClients }),
    lspCreator: await Services.MultiLspCreator(
      { debug, addresses: lspCreatorAddresses, network: networkChainId },
      { tables: appState, appClients },
      (event, data) => serviceEvents.emit("multiLspCreator", event, data)
    ),
    lsps: Services.LspState({ debug }, { tables: appState, appClients }),
    lspStats: Services.stats.Lsp({ debug }, appState),
    globalStats: Services.stats.Global({ debug }, appState),
  };

  const initBlock = await provider.getBlock("latest");

  async function lastBlockUpdate() {
    return appState.appStats.getLastBlockUpdate() || 0;
  }

  await services.lspCreator.update(await lastBlockUpdate(), initBlock.number);
  console.log("Got all LSP addresses");

  await services.lsps.update(await lastBlockUpdate(), initBlock.number);
  console.log("Updated LSP state");

  // we've update our state based on latest block we queried
  await appState.appStats.setLastBlockUpdate(initBlock.number);

  await services.erc20s.update();
  console.log("Updated tokens");

  await services.collateralPrices.update();
  console.log("Updated Collateral Prices");

  await services.lspStats.update();
  console.log("Updated LSP Stats");

  await services.globalStats.update();
  console.log("Updated Global Stats");

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
    await services.lsps.update(startBlock, endBlock);
    await services.erc20s.update();
    await appState.appStats.setLastBlockUpdate(endBlock);
  }

  // separate out price updates into a different loop to query every few minutes
  async function updatePrices() {
    await services.collateralPrices.update();
    await services.marketPrices.update();
    await services.lspStats.update();
    await services.globalStats.update();
  }

  // wait update rate before running loops, since all state was just updated on init
  new Promise((res) => setTimeout(res, updateRateS * 1000)).then(initLoops);

  async function initLoops() {
    console.log("Starting LSP API update loops");

    // listen for new lsp contracts since after we have started api, and make sure they get state updated asap
    // These events should only be bound after startup, since initialization above takes care of updating all contracts on startup
    // Because there is now a event driven dependency, the lsp creator and lsp state updater must be in same process
    serviceEvents.on("multiLspCreator", (event, data) => {
      // handle created events
      if (event === "created") {
        console.log("LspCreator found a new contract", JSON.stringify(data));
        services.lsps.updateLsps([data.address], data.startBlock, data.endBlock).catch(console.error);
      }
    });

    // listen for new emp contracts since after we start api, make sure they get state updates asap
    serviceEvents.on("empRegistry", (event, data) => {
      // handle created events
      if (event === "created") {
        console.log("EmpRegistry found a new contract", JSON.stringify(data));
        services.emps.updateAll([data.address], data.startBlock, data.endBlock).catch(console.error);
      }
    });

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
  }
};
