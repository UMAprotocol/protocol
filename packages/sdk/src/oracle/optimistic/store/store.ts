import GenericStore from "../../common/store/store";
import { OptimisticOracle } from "../../common/services/optimisticOracle";
import * as interfaces from "../../common/types/interfaces";

import { State, OptimisticOracleEvent } from "../types/state";

export type Emit = interfaces.Emit<State>;
export type Config = interfaces.StoreConfig<State, OptimisticOracle, OptimisticOracleEvent>;
export class Store extends GenericStore<State, OptimisticOracle, OptimisticOracleEvent> {}
