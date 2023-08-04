import { Provider } from "@ethersproject/abstract-provider";
import { paginatedEventQuery } from "@uma/common";
import { RequestPriceEvent } from "@uma/contracts-frontend/dist/typechain/core/ethers/OptimisticOracleV2";
import { OptimisticOracleV2Ethers } from "@uma/contracts-node";
import { Event, EventFilter, ethers } from "ethers";
import { blockDefaults } from "../utils/constants";
import { getContractInstanceWithProvider, tryHexToUtf8String } from "../utils/contracts";
import {
  BlockRange,
  OptimisticOracleClient,
  OptimisticOracleRequest,
  OptimisticOracleType,
  calculateRequestId,
} from "./common";

export class OptimisticOracleClientV2 extends OptimisticOracleClient<OptimisticOracleRequest> {
  constructor(
    _provider: Provider,
    _requests: Map<string, OptimisticOracleRequest> = new Map<string, OptimisticOracleRequest>(),
    _fetchedBlockRanges?: BlockRange[]
  ) {
    super(_provider, _requests, _fetchedBlockRanges);
  }

  async getEventsWithPagination<E extends Event>(
    filter: EventFilter,
    fromBlock: number,
    toBlock: number
  ): Promise<E[]> {
    const ooV2Contract = await getContractInstanceWithProvider<OptimisticOracleV2Ethers>(
      "OptimisticOracleV2",
      this.provider
    );

    const chainId = await this.provider.getNetwork().then((network) => network.chainId);

    const maxBlockLookBack =
      Number(process.env.MAX_BLOCK_LOOKBACK) ||
      blockDefaults[chainId.toString() as keyof typeof blockDefaults]?.maxBlockLookBack ||
      blockDefaults.other.maxBlockLookBack;

    const searchConfig = {
      fromBlock: fromBlock,
      toBlock: toBlock,
      maxBlockLookBack: maxBlockLookBack,
    };

    return paginatedEventQuery<E>(ooV2Contract, filter, searchConfig);
  }

  async applyRequestPriceEvent(requestPriceEvent: RequestPriceEvent): Promise<void> {
    const body = tryHexToUtf8String(requestPriceEvent.args.ancillaryData);
    const identifier = ethers.utils.parseBytes32String(requestPriceEvent.args.identifier);
    const timestamp = requestPriceEvent.args.timestamp.toNumber();
    const requester = requestPriceEvent.args.requester;
    const requestId = calculateRequestId(body, identifier, timestamp, requester);

    if (this.requests.has(requestId)) {
      return;
    }
    const ooV2Contract = await getContractInstanceWithProvider<OptimisticOracleV2Ethers>(
      "OptimisticOracleV2",
      this.provider
    );
    const newRequest = new OptimisticOracleRequest({
      requester: requestPriceEvent.args.requester,
      identifier: ethers.utils.parseBytes32String(requestPriceEvent.args.identifier),
      timestamp: requestPriceEvent.args.timestamp.toNumber(),
      requestTx: requestPriceEvent.transactionHash,
      type: OptimisticOracleType.PriceRequest,
      body: tryHexToUtf8String(requestPriceEvent.args.ancillaryData),
      blockNumber: requestPriceEvent.blockNumber,
      transactionIndex: requestPriceEvent.transactionIndex,
      isEventBased: await ooV2Contract
        .getRequest(
          requestPriceEvent.args.requester,
          requestPriceEvent.args.identifier,
          requestPriceEvent.args.timestamp,
          requestPriceEvent.args.ancillaryData
        )
        .then((r) => r[4][0]),
    });
    this.requests.set(requestId, newRequest);
  }

  protected async updateOracleRequests(newRanges: BlockRange[]): Promise<void> {
    const newRange = newRanges[newRanges.length - 1];

    const ooV2Contract = await getContractInstanceWithProvider<OptimisticOracleV2Ethers>(
      "OptimisticOracleV2",
      this.provider
    );

    const requestPriceEvents = await this.getEventsWithPagination<RequestPriceEvent>(
      ooV2Contract.filters.RequestPrice(),
      newRange[0],
      newRange[1]
    );

    await Promise.all(
      requestPriceEvents.map(async (requestPriceEvent) => {
        return this.applyRequestPriceEvent(requestPriceEvent);
      })
    );
  }

  protected createClientInstance(
    requests: Map<string, OptimisticOracleRequest>,
    fetchedBlockRanges: BlockRange[]
  ): OptimisticOracleClientV2 {
    return new OptimisticOracleClientV2(this.provider, requests, fetchedBlockRanges);
  }
}
