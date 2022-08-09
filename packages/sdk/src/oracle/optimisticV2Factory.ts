import { Client, factory } from "./client";
import { OptimisticOracleV2 } from "./services/optimisticOracleV2";
import { SortedRequests } from "./services/sortedRequests";
import { DefaultConfig, getMulticall2Address } from "./utils";
import { state } from "./types";
import { Emit } from "./store";

export default (
  config: state.PartialConfig,
  emit: Emit,
  sortedRequests: SortedRequests = new SortedRequests()
): Client => {
  const fullConfig = DefaultConfig({
    getMulticall2Address,
  })({ ...config }, state.OracleType.OptimisticV2);
  return factory(fullConfig, emit, OptimisticOracleV2, sortedRequests);
};
