import { Provider } from "@ethersproject/abstract-provider";
import { paginatedEventQuery } from "@uma/common";
import { RequestPriceEvent, ProposePriceEvent } from "@uma/contracts-node/typechain/core/ethers/OptimisticOracleV2";
import { OptimisticOracleV2Ethers } from "@uma/contracts-node";
import { Event, EventFilter, ethers } from "ethers";
import { blockDefaults } from "../utils/constants";
import { getContractInstanceWithProvider, tryHexToUtf8String } from "../utils/contracts";
import {
  BlockRange,
  OptimisticOracleClient,
  OptimisticOracleClientFilter,
  OptimisticOracleRequest,
  OptimisticOracleType,
  calculateRequestId,
} from "./common";

export class OptimisticOracleClientV2 extends OptimisticOracleClient<OptimisticOracleRequest> {
  constructor(
    _provider: Provider,
    _requests: Map<string, OptimisticOracleRequest> = new Map<string, OptimisticOracleRequest>(),
    _fetchedBlockRange?: BlockRange
  ) {
    super(_provider, _requests, _fetchedBlockRange);
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

  protected async applyRequestPriceEvent(
    requestPriceEvent: RequestPriceEvent,
    requestsToUpdate: Map<string, OptimisticOracleRequest>
  ): Promise<void> {
    const body = tryHexToUtf8String(requestPriceEvent.args.ancillaryData);
    const identifier = ethers.utils.parseBytes32String(requestPriceEvent.args.identifier);
    const timestamp = requestPriceEvent.args.timestamp.toNumber();
    const requester = requestPriceEvent.args.requester;
    const requestId = calculateRequestId(body, identifier, timestamp, requester);

    const newRequest = new OptimisticOracleRequest({
      requestData: {
        requester,
        identifier,
        timestamp,
        requestTx: requestPriceEvent.transactionHash,
        type: OptimisticOracleType.PriceRequest,
        body,
        rawBody: requestPriceEvent.args.ancillaryData,
        blockNumber: requestPriceEvent.blockNumber,
        transactionIndex: requestPriceEvent.transactionIndex,
      },
    });
    requestsToUpdate.set(requestId, newRequest);
  }

  async applyProposePriceEvent(
    proposePriceEvent: ProposePriceEvent,
    requestsToUpdate: Map<string, OptimisticOracleRequest>
  ): Promise<void> {
    const body = tryHexToUtf8String(proposePriceEvent.args.ancillaryData);
    const identifier = ethers.utils.parseBytes32String(proposePriceEvent.args.identifier);
    const timestamp = proposePriceEvent.args.timestamp.toNumber();
    const requester = proposePriceEvent.args.requester;
    const requestId = calculateRequestId(body, identifier, timestamp, requester);

    requestsToUpdate.set(
      requestId,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      requestsToUpdate.get(requestId)!.update({
        proposalData: {
          proposer: proposePriceEvent.args.proposer,
          proposedValue: proposePriceEvent.args.proposedPrice,
          proposeTx: proposePriceEvent.transactionHash,
          disputableUntil: proposePriceEvent.args.expirationTimestamp.toNumber(),
        },
      })
    );
  }

  protected async updateOracleRequests(newRange: BlockRange): Promise<Map<string, OptimisticOracleRequest>> {
    const requestsCopy = new Map<string, OptimisticOracleRequest>(this.requests);
    const ooV2Contract = await getContractInstanceWithProvider<OptimisticOracleV2Ethers>(
      "OptimisticOracleV2",
      this.provider
    );

    const requestPriceEvents = await this.getEventsWithPagination<RequestPriceEvent>(
      ooV2Contract.filters.RequestPrice(),
      newRange[0],
      newRange[1]
    );

    const proposePriceEvents = await this.getEventsWithPagination<ProposePriceEvent>(
      ooV2Contract.filters.ProposePrice(),
      newRange[0],
      newRange[1]
    );

    await Promise.all(
      requestPriceEvents.map((requestPriceEvent) => {
        return this.applyRequestPriceEvent(requestPriceEvent, requestsCopy);
      })
    );

    await Promise.all([
      ...proposePriceEvents.map(async (proposePriceEvent) => {
        return this.applyProposePriceEvent(proposePriceEvent, requestsCopy);
      }),
    ]);

    return requestsCopy;
  }

  protected createClientInstance(
    requests: Map<string, OptimisticOracleRequest>,
    fetchedBlockRange: BlockRange
  ): OptimisticOracleClientV2 {
    return new OptimisticOracleClientV2(this.provider, requests, fetchedBlockRange);
  }
}

export class OptimisticOracleClientV2FilterDisputeable
  implements OptimisticOracleClientFilter<OptimisticOracleRequest, OptimisticOracleRequest> {
  async filter(optimisticOracleRequests: OptimisticOracleRequest[]): Promise<OptimisticOracleRequest[]> {
    return optimisticOracleRequests.filter((request) => {
      return typeof request.disputableUntil == "number" && request.disputableUntil > Date.now() / 1000;
    });
  }
}
