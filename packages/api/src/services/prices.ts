import { AppClients, AppServices, AppState } from "../types";
import moment from "moment";

type Config = {
  backfillDays: number;
};
// break out this services specific state dependencies
type Dependencies = {
  tables: Pick<AppState, "appStats">;
  appClients: AppClients;
  services: AppServices;
  profile: (msg: string) => () => void;
};

export function Prices(config: Config, dependencies: Dependencies) {
  const { profile, services, tables } = dependencies;

  async function backfillPrices() {
    const lastBlockUpdate = (await tables.appStats.getLastBlockUpdate()) || 0;

    // backfill price histories, disable if not specified in env
    if (typeof config.backfillDays === "number" && lastBlockUpdate === 0) {
      console.log(`Backfilling price history from ${config.backfillDays} days ago`);
      await services.collateralPrices.backfill(moment().subtract(config.backfillDays, "days").valueOf());
      console.log("Updated Collateral Prices Backfill");

      // backfill price history only if runs for the first time
      await services.empStats.backfill();
      console.log("Updated EMP Backfill");

      await services.lspStats.backfill();
      console.log("Updated LSP Backfill");
    }
  }

  async function updatePrices() {
    await services.collateralPrices.update();
    await services.syntheticPrices.update();
    await services.marketPrices.update();
    await services.empStats.update();
    await services.lspStats.update();
    await services.globalStats.update();
  }

  async function updatePricesProfiled() {
    const end = profile("Update all prices");
    await backfillPrices();
    await updatePrices().catch(console.error).finally(end);
  }

  return {
    update: updatePricesProfiled,
    backfill: backfillPrices,
  };
}

export type Prices = ReturnType<typeof Prices>;
