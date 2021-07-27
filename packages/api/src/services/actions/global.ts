import assert from "assert";
import { Json, Actions, AppState, CurrencySymbol } from "../..";
import * as Queries from "../../libs/queries";
import bluebird from "bluebird";
import { BigNumber } from "ethers";

// actions use all the app state
type Dependencies = AppState;
type Config = undefined;

export function Handlers(config: Config, appState: Dependencies): Actions {
  const queries = {
    emp: Queries.Emp(appState),
    lsp: Queries.Lsp(appState),
  };

  const actions: Actions = {
    echo(...args: Json[]) {
      return args;
    },
    async tvl(currency: CurrencySymbol = "usd") {
      const sum = await bluebird.reduce(
        Object.values(queries),
        async (sum, queries) => {
          return sum.add((await queries.getTotalTvl(currency)) || "0");
        },
        BigNumber.from("0")
      );
      return sum.toString();
    },
  };

  // list all available actions
  const keys = Object.keys(actions);
  actions.actions = () => keys;

  return actions;
}
export default (config: Config, appState: AppState) => {
  const actions = Handlers(config, appState);
  return async (action: string, ...args: Json[]) => {
    assert(actions[action], `Invalid action: ${action}`);
    return actions[action](...args);
  };
};
