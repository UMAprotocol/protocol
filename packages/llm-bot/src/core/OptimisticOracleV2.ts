import { Provider } from "@ethersproject/abstract-provider";
import { paginatedEventQuery } from "@uma/common";
import {
  RequestPriceEvent,
  ProposePriceEvent,
  SettleEvent,
} from "@uma/contracts-node/typechain/core/ethers/OptimisticOracleV2";
import { OptimisticOracleV2Ethers } from "@uma/contracts-node";
import { BigNumber, Event, EventFilter, ethers } from "ethers";
import { blockDefaults } from "../utils/constants";
import { getContractInstanceWithProvider, tryHexToUtf8String } from "../utils/contracts";
import {
  BlockRange,
  OptimisticOracleClient,
  OptimisticOracleClientFilter,
  OptimisticOracleRequest,
  OptimisticOracleRequestDisputable,
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

  async applySettleEvent(
    settleEvent: SettleEvent,
    requestsToUpdate: Map<string, OptimisticOracleRequest>
  ): Promise<void> {
    const body = tryHexToUtf8String(settleEvent.args.ancillaryData);
    const identifier = ethers.utils.parseBytes32String(settleEvent.args.identifier);
    const timestamp = settleEvent.args.timestamp.toNumber();
    const requester = settleEvent.args.requester;
    const requestId = calculateRequestId(body, identifier, timestamp, requester);

    requestsToUpdate.set(
      requestId,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      requestsToUpdate.get(requestId)!.update({
        resolutionData: {
          resolvedValue: settleEvent.args.price,
          resolveTx: settleEvent.transactionHash,
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

    const settleEvents = await this.getEventsWithPagination<SettleEvent>(
      ooV2Contract.filters.Settle(),
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

    await Promise.all([
      ...settleEvents.map(async (settleEvent) => {
        return this.applySettleEvent(settleEvent, requestsCopy);
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
  // TODO interpret price values considering UMIPS and magic numbers
  async filter(optimisticOracleRequests: OptimisticOracleRequest[]): Promise<OptimisticOracleRequest[]> {
    return optimisticOracleRequests.filter((request) => {
      return typeof request.disputableUntil == "number" && request.disputableUntil > Date.now() / 1000;
    });
  }
}

export class DisputerStrategy {
  static process(request: OptimisticOracleRequest): Promise<OptimisticOracleRequestDisputable> {
    return Promise.resolve(
      new OptimisticOracleRequestDisputable({
        requestData: request.data.requestData,
        proposalData: request.data.proposalData,
        disputeData: request.data.disputeData,
        resolutionData: request.data.resolutionData,
        disputableData: {
          correctAnswer: ethers.utils.parseEther("1"),
          rawLLMInput: "",
          rawLLMOutput: "",
          shouldDispute: true,
        },
      })
    );
  }
}

export class Backtest {
  static test(request: OptimisticOracleRequestDisputable): boolean {
    if (typeof request.resolvedValue === "boolean") {
      return request.resolvedValue === request.data.disputableData.correctAnswer;
    }
    // At this point, we assume request.resolvedValue is of type BigNumber
    return (request.resolvedValue as BigNumber).eq(request.data.disputableData.correctAnswer as BigNumber);
  }
}
