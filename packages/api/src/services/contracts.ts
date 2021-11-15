import { AppClients, AppServices, AppState, BaseConfig } from "../types";
import { expirePromise, getSamplesBetween } from "../libs/utils";
import assert from "assert";
import bluebird from "bluebird";

type Config = BaseConfig & {
  detectContractsBatchSize?: number;
  updateContractsBatchSize?: number;
};

// break out this services specific state dependencies
type Dependencies = {
  tables: Pick<AppState, "appStats">;
  appClients: AppClients;
  services: AppServices;
  profile: (msg: string) => () => void;
};

export function Contracts(config: Config, dependencies: Dependencies) {
  const { profile } = dependencies;

  // break all state updates by block events into a cleaner function
  async function updateContractState(startBlock: number, endBlock: number) {
    const { services, tables } = dependencies;
    // ignore case when startblock == endblock, this can happen when loop is run before a new block has changed
    if (startBlock === endBlock) return;
    assert(startBlock < endBlock, "Startblock must be lower than endBlock");
    // update everyting
    await services.emps.update(startBlock, endBlock);
    await services.lsps.update(startBlock, endBlock);
    await services.erc20s.update();
    await tables.appStats.setLastBlockUpdate(endBlock);
  }

  async function updateContractsStateProfiled() {
    const end = profile("Running contract state updates");
    // adding in a timeout rejection if the update takes too long
    await expirePromise(
      async () => {
        const { appClients, tables } = dependencies;
        const batchSize = config.updateContractsBatchSize;
        const lastBlockUpdate = (await tables.appStats.getLastBlockUpdate()) || 0;
        const lastBlock = (await appClients.provider.getBlock("latest")).number;

        if (batchSize) {
          const intervals = getSamplesBetween(lastBlockUpdate, lastBlock, batchSize);
          for (const [from, to] of intervals) {
            await updateContractState(from, to);
            console.log("Updated Contract state between blocks", from, to);
          }
        } else {
          await updateContractState(lastBlockUpdate, lastBlock);
          console.log("Updated Contract state between blocks", lastBlockUpdate, lastBlock);
        }
        // throw an error if this fails to process in 15 minutes
      },
      15 * 60 * 1000,
      "Contract state updates timed out"
    )
      .catch(console.error)
      .finally(end);
  }

  async function detectNewContracts(startBlock: number, endBlock: number) {
    const { services } = dependencies;
    // ignore case when startblock == endblock, this can happen when loop is run before a new block has changed
    if (startBlock === endBlock) return;
    assert(startBlock < endBlock, "Startblock must be lower than endBlock");
    await services.registry(startBlock, endBlock);
    await services.lspCreator.update(startBlock, endBlock);
  }

  async function detectContractsProfiled() {
    const { profile, tables, appClients } = dependencies;
    const end = profile("Detecting New Contracts");
    // adding in a timeout rejection if the update takes too long
    await expirePromise(
      async () => {
        const batchSize = config.detectContractsBatchSize;
        const lastBlockUpdate = (await tables.appStats.getLastBlockUpdate()) || 0;
        const lastBlock = (await appClients.provider.getBlock("latest")).number;

        if (batchSize) {
          const intervals = getSamplesBetween(lastBlockUpdate, lastBlock, batchSize);
          await bluebird.map(
            intervals,
            async ([from, to]) => {
              await detectNewContracts(from, to);
              console.log("Checked for new contracts between blocks", from, to);
            },
            { concurrency: 20 }
          );
        } else {
          await detectNewContracts(lastBlockUpdate, lastBlock);
          console.log("Checked for new contracts between blocks", lastBlockUpdate, lastBlock);
        }
        // error out if this fails to complete in 5 minutes
      },
      5 * 60 * 1000,
      "Detecting new contracts timed out"
    )
      .catch(console.error)
      .finally(end);
  }

  return {
    detect: detectContractsProfiled,
    update: updateContractsStateProfiled,
  };
}

export type Contracts = ReturnType<typeof Contracts>;
