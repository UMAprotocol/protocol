import { Client, factory } from "./client";
import { OptimisticOracle } from "./services/optimisticOracle";
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
  })({ ...config }, state.OracleType.Optimistic);
  return factory(fullConfig, emit, OptimisticOracle, sortedRequests);
};
