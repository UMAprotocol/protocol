import { Provider } from "@ethersproject/abstract-provider";
import { ethers } from "ethers";
import {
  BlockRange,
  OptimisticOracleClient,
  OptimisticOracleClientFilter,
  OptimisticOracleRequest,
  OptimisticOracleRequestData,
} from "./common";

export class OptimisticOracleClientV2 extends OptimisticOracleClient<OptimisticOracleRequest> {
  constructor(
    _provider: Provider,
    _requests: Map<string, OptimisticOracleRequest> = new Map(),
    _fetchedBlockRange?: BlockRange
  ) {
    super(_provider, _requests, _fetchedBlockRange);
  }

  protected async updateOracleRequests(blockRange: BlockRange): Promise<Map<string, OptimisticOracleRequest>> {
    // TODO: Implement this for the OptimisticOracleV2
    blockRange;
    return new Map();
  }

  protected createClientInstance(
    requests: Map<string, OptimisticOracleRequest>,
    fetchedBlockRange: BlockRange
  ): OptimisticOracleClientV2 {
    return new OptimisticOracleClientV2(this.provider, requests, fetchedBlockRange);
  }
}

class OptimisticOracleRequestPolymarket extends OptimisticOracleRequest {
  readonly polymarketQuestionTitle: string;

  constructor(data: OptimisticOracleRequestData & { polymarketQuestionTitle: string }) {
    super(data);
    this.polymarketQuestionTitle = data.polymarketQuestionTitle;
  }
}

export class OptimisticOracleClientV2Polymarket extends OptimisticOracleClient<OptimisticOracleRequestPolymarket> {
  constructor(
    _provider: Provider,
    _requests: Map<string, OptimisticOracleRequestPolymarket> = new Map(),
    _fetchedBlockRange?: BlockRange
  ) {
    super(_provider, _requests, _fetchedBlockRange);
  }

  protected async updateOracleRequests(
    blockRange: BlockRange
  ): Promise<Map<string, OptimisticOracleRequestPolymarket>> {
    // TODO: Implement this for the OptimisticOracleV2
    blockRange;
    return new Map();
  }

  protected createClientInstance(
    requests: Map<string, OptimisticOracleRequestPolymarket>,
    fetchedBlockRange: BlockRange
  ): OptimisticOracleClientV2Polymarket {
    return new OptimisticOracleClientV2Polymarket(this.provider, requests, fetchedBlockRange);
  }
}

export class OptimisticOracleClientV3 extends OptimisticOracleClient<OptimisticOracleRequest> {
  constructor(
    _provider: Provider,
    _requests: Map<string, OptimisticOracleRequest> = new Map(),
    _fetchedBlockRange?: BlockRange
  ) {
    super(_provider, _requests, _fetchedBlockRange);
  }

  protected async updateOracleRequests(blockRange: BlockRange): Promise<Map<string, OptimisticOracleRequest>> {
    // TODO: Implement this for the OptimisticOracleV3
    blockRange;
    return new Map();
  }

  protected createClientInstance(
    requests: Map<string, OptimisticOracleRequest>,
    fetchedBlockRange: BlockRange
  ): OptimisticOracleClientV3 {
    return new OptimisticOracleClientV3(this.provider, requests, fetchedBlockRange);
  }
}

export class OptimisticOracleClientFilterV2ToPolymarket
  implements OptimisticOracleClientFilter<OptimisticOracleRequest, OptimisticOracleRequestPolymarket> {
  async filter(optimisticOracleRequests: OptimisticOracleRequest[]): Promise<OptimisticOracleRequestPolymarket[]> {
    // Filtering logic for price requests
    const filteredRequests = optimisticOracleRequests.map((request) => {
      return new OptimisticOracleRequestPolymarket({
        ...request.data,
        polymarketQuestionTitle: "What is the price of ETH?",
      });
    });

    return filteredRequests;
  }
}

const main = async () => {
  const provider = new ethers.providers.JsonRpcProvider("http://localhost:8545");

  const oov2 = new OptimisticOracleClientV2(provider);

  const oov2_updated = await oov2.updateWithBlockRange();

  const oov2_filtered = await new OptimisticOracleClientFilterV2ToPolymarket().filter(
    Array.from(oov2_updated.requests.values())
  );
  oov2_filtered;
};

main();
