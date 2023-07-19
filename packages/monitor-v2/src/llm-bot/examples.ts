import { Provider } from "@ethersproject/abstract-provider";
import { ethers } from "ethers";
import {
  LLMStrategy,
  OptimisticOracleClient,
  OptimisticOracleClientFilter,
  OptimisticOracleRequest,
  OptimisticOracleStrategyHandler,
} from "./common";

export class OptimisticOracleClientV2 extends OptimisticOracleClient<OptimisticOracleRequest> {
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
  ): OptimisticOracleClientV2 {
    return new OptimisticOracleClientV2(this.provider, requests, fetchedBlockRange);
  }
}

class OptimisticOracleRequestPolymarket extends OptimisticOracleRequest {
  readonly polymarketQuestionTitle: string;

  constructor(data: OptimisticOracleRequestPolymarket) {
    super(data);
    this.polymarketQuestionTitle = data.polymarketQuestionTitle;
  }
}

class OptimisticOracleRequestPolymarketResult extends OptimisticOracleRequestPolymarket {
  readonly dispute: boolean;

  constructor(data: OptimisticOracleRequestPolymarketResult) {
    super(data);
    this.dispute = data.dispute;
  }
}

export class OptimisticOracleClientV2Polymarket extends OptimisticOracleClient<OptimisticOracleRequestPolymarket> {
  constructor(
    _provider: Provider,
    _requests: OptimisticOracleRequestPolymarket[] = [],
    _fetchedBlockRange?: [number, number]
  ) {
    super(_provider, _requests, _fetchedBlockRange);
  }

  protected async fetchOracleRequests(blockRange: [number, number]): Promise<OptimisticOracleRequestPolymarket[]> {
    // TODO: Implement this for the OptimisticOracleV2
    blockRange;
    return [];
  }

  protected createClientInstance(
    requests: OptimisticOracleRequestPolymarket[],
    fetchedBlockRange: [number, number]
  ): OptimisticOracleClientV2Polymarket {
    return new OptimisticOracleClientV2Polymarket(this.provider, requests, fetchedBlockRange);
  }
}

export class OptimisticOracleClientV3 extends OptimisticOracleClient<OptimisticOracleRequest> {
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

export class OptimisticOracleClientFilterV2ToPolymarket
  implements OptimisticOracleClientFilter<OptimisticOracleRequest, OptimisticOracleRequestPolymarket> {
  async filter(optimisticOracleRequests: OptimisticOracleRequest[]): Promise<OptimisticOracleRequestPolymarket[]> {
    // Filtering logic for price requests
    const filteredRequests = optimisticOracleRequests.map((request) => {
      return new OptimisticOracleRequestPolymarket({
        ...request,
        polymarketQuestionTitle: "What is the price of ETH?",
      });
    });

    return filteredRequests;
  }
}

class Strategy extends LLMStrategy<OptimisticOracleRequestPolymarket, OptimisticOracleRequestPolymarketResult> {
  async process() {
    this.results = this.optimisticOracleRequests.map(
      (request) =>
        new OptimisticOracleRequestPolymarketResult({
          ...request,
          dispute: true,
        })
    );
  }
}

class StrategyHandler extends OptimisticOracleStrategyHandler<OptimisticOracleRequestPolymarketResult> {
  process = async () => {
    Promise.all(
      this.strategyResults.map((result) => {
        if (result.dispute) {
          return this.disputeRequest(result);
        }
      })
    );
  };
}

const main = async () => {
  const provider = new ethers.providers.JsonRpcProvider("http://localhost:8545");

  const oov2 = new OptimisticOracleClientV2(provider);

  const oov2_updated = await oov2.updateWithBlockRange();

  const oov2_filtered = await new OptimisticOracleClientFilterV2ToPolymarket().filter(oov2_updated.getRequests());

  const strategy = new Strategy(oov2_filtered);

  await strategy.process();

  await new StrategyHandler(strategy.getResults()).process();
};

main();
