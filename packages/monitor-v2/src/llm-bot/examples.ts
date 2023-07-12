import { Provider } from "@ethersproject/abstract-provider";
import { OptimisticOracleClient, OptimisticOracleRequest, OptimisticOracleType, OracleClientFilter } from "./common";

export class OptimisticOracleClientV2 extends OptimisticOracleClient {
  constructor(_provider: Provider, _requests: OptimisticOracleRequest[] = [], _fetchedBlockRange?: [number, number]) {
    super(_provider, _requests, _fetchedBlockRange);
  }

  protected async fetchOracleRequests(blockRange: [number, number]): Promise<OptimisticOracleRequest[]> {
    // TODO: Implement this for the OptimisticOracleV2
    blockRange;
    return [];
  }

  protected createClientInstance(
    requests: OptimisticOracleRequest[],
    fetchedBlockRange: [number, number]
  ): OptimisticOracleClient {
    return new OptimisticOracleClientV2(this.provider, requests, fetchedBlockRange);
  }
}

export class OptimisticOracleClientV3 extends OptimisticOracleClient {
  constructor(_provider: Provider, _requests: OptimisticOracleRequest[] = [], _fetchedBlockRange?: [number, number]) {
    super(_provider, _requests, _fetchedBlockRange);
  }

  protected async fetchOracleRequests(blockRange: [number, number]): Promise<OptimisticOracleRequest[]> {
    // TODO: Implement this for the OptimisticOracleV3
    blockRange;
    return [];
  }

  protected createClientInstance(
    requests: OptimisticOracleRequest[],
    fetchedBlockRange: [number, number]
  ): OptimisticOracleClientV3 {
    return new OptimisticOracleClientV3(this.provider, requests, fetchedBlockRange);
  }
}

export class PriceRequestFilterExampleV2toV3
  implements OracleClientFilter<OptimisticOracleClientV2, OptimisticOracleClientV3> {
  async filter(optimisticOracleClient: OptimisticOracleClientV2): Promise<OptimisticOracleClientV3> {
    // Filtering logic for price requests
    const filteredRequests = optimisticOracleClient.getRequests().filter((request) => {
      return request.type === OptimisticOracleType.PriceRequest;
    });

    // Create a new instance of OptimisticOracleClient with the filtered requests
    const filteredClient = new OptimisticOracleClientV3(
      optimisticOracleClient.getProvider(),
      filteredRequests,
      optimisticOracleClient.getFetchedBlockRange()
    );

    return filteredClient;
  }
}
