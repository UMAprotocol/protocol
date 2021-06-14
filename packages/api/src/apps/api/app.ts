import assert from "assert";
import { tables, Coingecko } from "@uma/sdk";
import { ethers } from "ethers";
import * as Services from "../../services";
import Express from "../../services/express";
import Actions from "../../services/actions";
import { ProcessEnv, AppState } from "../..";

async function run(env: ProcessEnv) {
  assert(env.CUSTOM_NODE_URL, "requires CUSTOM_NODE_URL");
  assert(env.EXPRESS_PORT, "requires EXPRESS_PORT");

  const provider = new ethers.providers.WebSocketProvider(env.CUSTOM_NODE_URL);
  // how many blocks to skip before running updates on contract state
  const updateBlocks = Number(env.UPDATE_BLOCKS || 1);
  // default to 10 days worth of blocks
  const oldestBlock = Number(env.OLDEST_BLOCK_MS || 10 * 60 * 60 * 24 * 1000);

  assert(updateBlocks > 0, "updateBlocks must be 1 or higher");

  // state shared between services
  const appState: AppState = {
    provider,
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
    erc20s: tables.erc20s.JsMap(),
    lastBlock: 0,
    lastBlockUpdate: 0,
    registeredEmps: new Set<string>(),
    collateralAddresses: new Set<string>(),
    syntheticAddresses: new Set<string>(),
  };
  // services for ingesting data
  const services = {
    blocks: Services.Blocks({}, appState),
    emps: Services.Emps({}, appState),
    registry: Services.Registry({}, appState),
    prices: Services.Prices({}, appState),
    erc20s: Services.Erc20s({}, appState),
  };

  // services consuming data
  const actions = Actions({}, appState);

  // warm caches
  await services.registry();
  console.log("Got all emp addresses");
  await services.emps();
  console.log("Updated emp state");
  await services.erc20s.update();
  console.log("Updated tokens");
  await services.prices.update();
  console.log("Updated prices");

  // expose calls through express
  await Express({ port: Number(env.EXPRESS_PORT) }, actions);

  // main update loop, update every block
  provider.on("block", (blockNumber: number) => {
    // dont do update if this number or blocks hasnt passed
    services.blocks.handleNewBlock(blockNumber).catch(console.error);
    if (blockNumber - appState.lastBlockUpdate >= updateBlocks) {
      services.registry(appState.lastBlock, blockNumber).catch(console.error);
      services.emps(appState.lastBlock, blockNumber).catch(console.error);
      appState.lastBlockUpdate = blockNumber;
      services.erc20s.update().catch(console.error);
    }
    appState.lastBlock = blockNumber;
    services.blocks.cleanBlocks(oldestBlock).catch(console.error);
  });

  // coingeckos prices don't update very fast, so set it on an interval every few minutes
  setInterval(() => {
    services.prices.update().catch(console.error);
  }, 5 * 60 * 1000);
}

export default run;
