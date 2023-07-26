import { OptimisticOracleV2Ethers } from "@uma/contracts-node";
import { OptimisticOracleClient, OptimisticOracleRequest, OptimisticOracleType } from "./common";
import { Provider } from "@ethersproject/abstract-provider";
import { getContractInstanceWithProvider, tryHexToUtf8String } from "../utils/contracts";
import { RequestPriceEvent } from "@uma/contracts-frontend/dist/typechain/core/ethers/OptimisticOracleV2";
import { paginatedEventQuery } from "@uma/common";
import { ethers } from "ethers";

export class OptimisticOracleClientV2 extends OptimisticOracleClient<OptimisticOracleRequest> {
  constructor(
    _provider: Provider,
    _requests: OptimisticOracleRequest[] = [],
    _fetchedBlockRanges?: [number, number][]
  ) {
    super(_provider, _requests, _fetchedBlockRanges);
  }

  protected async fetchOracleRequests(blockRange: [number, number]): Promise<OptimisticOracleRequest[]> {
    const ooV2Contract = await getContractInstanceWithProvider<OptimisticOracleV2Ethers>(
      "OptimisticOracleV2",
      this.provider
    );

    const maxBlockLookBack = 10000;

    const searchConfig = {
      fromBlock: blockRange[0],
      toBlock: blockRange[1],
      maxBlockLookBack: maxBlockLookBack,
    };

    const requests = await paginatedEventQuery<RequestPriceEvent>(
      ooV2Contract,
      ooV2Contract.filters.RequestPrice(),
      searchConfig
    );

    return requests.map((request) => {
      return new OptimisticOracleRequest({
        requester: request.args.requester,
        identifier: ethers.utils.parseBytes32String(request.args.identifier),
        timestamp: request.args.timestamp.toNumber(),
        requestTx: request.transactionHash,
        type: OptimisticOracleType.PriceRequest,
        body: tryHexToUtf8String(request.args.ancillaryData),
      });
    });
  }

  protected createClientInstance(
    requests: OptimisticOracleRequest[],
    fetchedBlockRanges: [number, number][]
  ): OptimisticOracleClientV2 {
    return new OptimisticOracleClientV2(this.provider, requests, fetchedBlockRanges);
  }
}
