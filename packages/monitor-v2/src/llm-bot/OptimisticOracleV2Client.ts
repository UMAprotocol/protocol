import { OptimisticOracleClient, OptimisticOracleRequest } from "./common";
import { Provider } from "@ethersproject/abstract-provider";

export class OptimisticOracleClientV2 extends OptimisticOracleClient<OptimisticOracleRequest> {
  constructor(
    _provider: Provider,
    _requests: OptimisticOracleRequest[] = [],
    _fetchedBlockRanges?: [number, number][]
  ) {
    super(_provider, _requests, _fetchedBlockRanges);
  }

  protected async fetchOracleRequests(blockRange: [number, number]): Promise<OptimisticOracleRequest[]> {
    // TODO: Implement this for the OptimisticOracleV2
    blockRange;
    return [];
  }

  protected createClientInstance(
    requests: OptimisticOracleRequest[],
    fetchedBlockRanges: [number, number][]
  ): OptimisticOracleClientV2 {
    return new OptimisticOracleClientV2(this.provider, requests, fetchedBlockRanges);
  }
}
