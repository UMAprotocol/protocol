import assert from "assert";
import { Actions, AppState, Json, OrchestratorServices } from "../../types";

type Config = undefined;
type Dependencies = {
  tables: AppState;
  services: OrchestratorServices;
};

function Handlers(config: Config, dependencies: Dependencies) {
  const actions: Actions = {
    async runContracts() {
      const { services } = dependencies;
      await services.contracts.detect();
      await services.contracts.update();
    },
    async runPrices() {
      const { services } = dependencies;
      await services.prices.update();
    },
  };

  // list all available actions
  const keys = Object.keys(actions);
  actions.actions = () => keys;

  return actions;
}

export default (config: Config, dependencies: Dependencies) => {
  const actions = Handlers(config, dependencies);
  return async (action: string, ...args: Json[]) => {
    assert(actions[action], `Invalid action: ${action}`);
    return actions[action](...args);
  };
};
