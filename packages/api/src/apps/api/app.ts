import assert from "assert";
import Web3 from "web3";
import { ethers } from "ethers";

import { tables, Coingecko } from "@uma/sdk";

import * as Services from "../../services";
import Express from "../../services/express";
import Actions from "../../services/actions";
import { ProcessEnv, AppState } from "../..";
import { empStats } from "../../tables";

async function run(env: ProcessEnv) {
  assert(env.CUSTOM_NODE_URL, "requires CUSTOM_NODE_URL");
  assert(env.EXPRESS_PORT, "requires EXPRESS_PORT");

  const provider = new ethers.providers.WebSocketProvider(env.CUSTOM_NODE_URL);

  // we need web3 for syth price feeds
  const web3 = new Web3(env.CUSTOM_NODE_URL);

  // how many blocks to skip before running updates on contract state
  const updateBlocks = Number(env.UPDATE_BLOCKS || 1);
  // default to 10 days worth of blocks
  const oldestBlock = Number(env.OLDEST_BLOCK_MS || 10 * 60 * 60 * 24 * 1000);

  assert(updateBlocks > 0, "updateBlocks must be 1 or higher");

  // state shared between services
  const appState: AppState = {
    provider,
    web3,
    coingecko: new Coingecko(),
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
    erc20s: tables.erc20s.JsMap(),
    stats: {
      usd: {
        latest: empStats.JsMap(),
        history: {},
      },
    },
    lastBlock: 0,
    lastBlockUpdate: 0,
    registeredEmps: new Set<string>(),
    collateralAddresses: new Set<string>(),
    syntheticAddresses: new Set<string>(),
  };
  // services for ingesting data
  const services = {
    // these services can optionally be configured with a config object, but currently they are undefined or have defaults
    blocks: Services.Blocks(undefined, appState),
    emps: Services.Emps(undefined, appState),
    registry: Services.Registry({}, appState),
    collateralPrices: Services.CollateralPrices({}, appState),
    syntheticPrices: Services.SyntheticPrices(
      {
        cryptowatchApiKey: env.cryptowatchApiKey,
        tradermadeApiKey: env.tradermadeApiKey,
        quandlApiKey: env.quandlApiKey,
        defipulseApiKey: env.defipulseApiKey,
      },
      appState
    ),
    erc20s: Services.Erc20s(undefined, appState),
    empStats: Services.EmpStats({}, appState),
  };

  // services consuming data
  const actions = Actions(undefined, appState);

  // warm caches
  await services.registry();
  console.log("Got all emp addresses");
  await services.emps();
  console.log("Updated emp state");
  await services.erc20s.update();
  console.log("Updated tokens");
  await services.collateralPrices.update();
  console.log("Updated Collateral Prices");
  await services.syntheticPrices.update();
  console.log("Updated Synthetic Prices");
  await services.empStats.update();
  console.log("Updated EMP Stats");

  // expose calls through express
  await Express({ port: Number(env.EXPRESS_PORT) }, actions);

  // break all state updates by block events into a cleaner function
  async function updateByBlock(blockNumber: number) {
    await services.blocks.handleNewBlock(blockNumber);
    // dont do update if this number or blocks hasnt passed
    if (blockNumber - appState.lastBlockUpdate >= updateBlocks) {
      // update everyting
      await services.registry(appState.lastBlock, blockNumber);
      await services.emps(appState.lastBlock, blockNumber);
      await services.erc20s.update();
      await services.empStats.update();

      appState.lastBlockUpdate = blockNumber;
    }
    appState.lastBlock = blockNumber;
    await services.blocks.cleanBlocks(oldestBlock);
  }

  // main update loop, update every block
  provider.on("block", (blockNumber: number) => {
    updateByBlock(blockNumber).catch(console.error);
  });

  // separate out price updates into a different loop to query every few minutes
  async function updatePrices() {
    await services.collateralPrices.update();
    await services.syntheticPrices.update();
  }

  // coingeckos prices don't update very fast, so set it on an interval every few minutes
  setInterval(() => {
    updatePrices().catch(console.error);
  }, 5 * 60 * 1000);
}

export default run;
