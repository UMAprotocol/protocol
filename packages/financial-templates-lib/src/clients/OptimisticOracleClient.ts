// A thick client for getting information about an OptimisticOracle. Used to get price requests and
// proposals, which can be disputed and settled.
import { averageBlockTimeSeconds, revertWrapper, getEventsWithPaginatedBlockSearch, Web3Contract } from "@uma/common";
import Web3 from "web3";
import type { Logger } from "winston";
import { Abi, isDefined } from "../types";
import {
  SkinnyOptimisticOracleWeb3,
  OptimisticOracleWeb3,
  VotingAncillaryInterfaceTestingWeb3,
  OptimisticOracleWeb3Events,
  SkinnyOptimisticOracleWeb3Events,
  OptimisticOracleV2Web3,
} from "@uma/contracts-node";

type SkinnyRequestPrice = SkinnyOptimisticOracleWeb3Events.RequestPrice;
type SkinnyProposePrice = SkinnyOptimisticOracleWeb3Events.ProposePrice;
type SkinnyDisputePrice = SkinnyOptimisticOracleWeb3Events.DisputePrice;
type SkinnySettle = OptimisticOracleWeb3Events.Settle;
type RequestPrice = OptimisticOracleWeb3Events.RequestPrice;
type ProposePrice = OptimisticOracleWeb3Events.ProposePrice;
type DisputePrice = OptimisticOracleWeb3Events.DisputePrice;
type Settle = OptimisticOracleWeb3Events.Settle;

type RequestPriceReturnValues = SkinnyRequestPrice["returnValues"] | RequestPrice["returnValues"];
type ProposePriceReturnValues = SkinnyProposePrice["returnValues"] | ProposePrice["returnValues"];
type DisputePriceReturnValues = SkinnyDisputePrice["returnValues"] | DisputePrice["returnValues"];
type AnyRequestEvent =
  | RequestPrice
  | ProposePrice
  | DisputePrice
  | Settle
  | SkinnyRequestPrice
  | SkinnyProposePrice
  | SkinnyDisputePrice
  | SkinnySettle;

interface SkinnyRequest {
  proposer: string;
  disputer: string;
  currency: string;
  settled: boolean;
  proposedPrice: string;
  resolvedPrice: string;
  expirationTime: string;
  reward: string;
  finalFee: string;
  bond: string;
  customLiveness: string;
}

export type OptimisticOracleContract = SkinnyOptimisticOracleWeb3 | OptimisticOracleWeb3 | OptimisticOracleV2Web3;

export enum OptimisticOracleType {
  OptimisticOracle = "OptimisticOracle",
  OptimisticOracleV2 = "OptimisticOracleV2",
  SkinnyOptimisticOracle = "SkinnyOptimisticOracle",
}
export class OptimisticOracleClient {
  public readonly oracle: OptimisticOracleContract;
  public readonly voting: VotingAncillaryInterfaceTestingWeb3;

  // Store the last on-chain time the clients were updated to inform price request information.
  private lastUpdateTimestamp = 0;
  private hexToUtf8 = Web3.utils.hexToUtf8;
  public chainId = -1;

  // Oracle Data structures & values to enable synchronous returns of the state seen by the client.
  private unproposedPriceRequests: RequestPriceReturnValues[] = [];
  private undisputedProposals: ProposePriceReturnValues[] = [];
  private expiredProposals: ProposePriceReturnValues[] = [];
  private settleableDisputes: DisputePriceReturnValues[] = [];

  /**
   * @notice Constructs new OptimisticOracleClient.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} oracleAbi OptimisticOracle truffle ABI object.
   * @param {Object} votingAbi Voting truffle ABI object.
   * @param {Object} web3 Provider from Truffle instance to connect to Ethereum network.
   * @param {String} oracleAddress Ethereum address of the OptimisticOracle contract deployed on the current network.
   * @param {String} votingAddress Ethereum address of the Voting contract deployed on the current network.
   * @param {Number} lookback Any requests, proposals, or disputes that occurred prior to this timestamp will be ignored.
   * Used to limit the web3 requests made by this client.
   * @param {OptimisticOracleType} oracleType Type of OptimisticOracle to query state for. Defaults to
   * "OptimisticOracle".
   * @param {Number} blocksPerEventSearch Amount of blocks to search per web3 event search.
   * @return None or throws an Error.
   */
  constructor(
    private readonly logger: Logger,
    oracleAbi: Abi,
    votingAbi: Abi,
    public readonly web3: Web3,
    oracleAddress: string,
    votingAddress: string,
    public readonly lookback: number = 604800, // 1 Week
    public readonly oracleType: OptimisticOracleType = OptimisticOracleType.OptimisticOracle,
    public readonly blocksPerEventSearch: number | null = null
  ) {
    // Optimistic Oracle contract:
    this.oracle = (new web3.eth.Contract(oracleAbi, oracleAddress) as unknown) as OptimisticOracleContract;
    this.oracleType = oracleType;

    // Voting contract we'll use to determine whether OO disputes can be settled:
    this.voting = (new web3.eth.Contract(votingAbi, votingAddress) as unknown) as VotingAncillaryInterfaceTestingWeb3;

    // Oracle Data structures & values to enable synchronous returns of the state seen by the client.
    this.unproposedPriceRequests = [];
    this.undisputedProposals = [];
    this.expiredProposals = [];
    this.settleableDisputes = [];
  }

  // Returns an array of Price Requests that have no proposals yet.
  public getUnproposedPriceRequests(): RequestPriceReturnValues[] {
    return this.unproposedPriceRequests;
  }

  // Returns an array of Price Proposals that have not been disputed.
  public getUndisputedProposals(): ProposePriceReturnValues[] {
    return this.undisputedProposals;
  }

  // Returns an array of expired Price Proposals that can be settled and that involved
  // the caller as the proposer
  public getSettleableProposals(callers?: string[]): ProposePriceReturnValues[] {
    if (!callers) return this.expiredProposals;

    if (this.oracleType === OptimisticOracleType.SkinnyOptimisticOracle) {
      return (this.expiredProposals as SkinnyProposePrice["returnValues"][]).filter((event) => {
        return callers.includes(((event.request as unknown) as SkinnyRequest).proposer);
      });
    } else {
      return ((this.expiredProposals as unknown) as ProposePrice["returnValues"][]).filter((event) => {
        return callers.includes(event.proposer);
      });
    }
  }

  // Returns disputes that can be settled and that involved the caller as the disputer
  public getSettleableDisputes(callers?: string[]): DisputePriceReturnValues[] {
    if (!callers) return this.settleableDisputes;

    if (this.oracleType === OptimisticOracleType.SkinnyOptimisticOracle) {
      return (this.settleableDisputes as SkinnyDisputePrice["returnValues"][]).filter((event) => {
        return callers.includes(((event.request as unknown) as SkinnyRequest).disputer);
      });
    } else {
      return (this.settleableDisputes as DisputePrice["returnValues"][]).filter((event) => {
        return callers.includes(event.disputer);
      });
    }
  }

  // Returns the last update timestamp.
  public getLastUpdateTime(): number {
    return this.lastUpdateTimestamp;
  }

  private _getPriceRequestKey(reqEvent: AnyRequestEvent): string {
    return `${reqEvent.returnValues.requester}-${reqEvent.returnValues.identifier}-${reqEvent.returnValues.timestamp}-${reqEvent.returnValues.ancillaryData}`;
  }

  public async update(): Promise<void> {
    // Determine earliest block to query events for based on lookback window:
    if (this.chainId === -1) this.chainId = await this.web3.eth.getChainId();
    const [averageBlockTime, currentBlock] = await Promise.all([
      averageBlockTimeSeconds(this.chainId),
      this.web3.eth.getBlock("latest"),
    ]);
    const lookbackBlocks = Math.ceil(this.lookback / averageBlockTime);
    const earliestBlockToQuery = Math.max(currentBlock.number - lookbackBlocks, 0);

    const eventResults = await Promise.all([
      getEventsWithPaginatedBlockSearch(
        (this.oracle as unknown) as Web3Contract,
        "RequestPrice",
        earliestBlockToQuery,
        currentBlock.number,
        this.blocksPerEventSearch
      ),
      getEventsWithPaginatedBlockSearch(
        (this.oracle as unknown) as Web3Contract,
        "ProposePrice",
        earliestBlockToQuery,
        currentBlock.number,
        this.blocksPerEventSearch
      ),
      getEventsWithPaginatedBlockSearch(
        (this.oracle as unknown) as Web3Contract,
        "DisputePrice",
        earliestBlockToQuery,
        currentBlock.number,
        this.blocksPerEventSearch
      ),
      getEventsWithPaginatedBlockSearch(
        (this.oracle as unknown) as Web3Contract,
        "Settle",
        earliestBlockToQuery,
        currentBlock.number,
        this.blocksPerEventSearch
      ),
    ]);
    const requestEvents = (eventResults[0].eventData as unknown) as (RequestPrice | SkinnyRequestPrice)[];
    const proposalEvents = (eventResults[1].eventData as unknown) as (ProposePrice | SkinnyProposePrice)[];
    const disputeEvents = (eventResults[2].eventData as unknown) as (DisputePrice | SkinnyDisputePrice)[];
    const settleEvents = (eventResults[3].eventData as unknown) as (Settle | SkinnySettle)[];

    this.logger.debug({
      at: "OptimisticOracleClient",
      message: "Queried past event requests",
      eventRequestCount: eventResults.map((e) => e.web3RequestCount).reduce((x, y) => x + y),
      earliestBlockToQuery: earliestBlockToQuery ?? 0,
      latestBlockToQuery: currentBlock.number,
      blocksPerEventSearch: this.blocksPerEventSearch,
    });

    // Store price requests that have NOT been proposed to yet:
    const unproposedPriceRequests = (requestEvents as RequestPrice[]).filter((event) => {
      const key = this._getPriceRequestKey(event);
      const hasProposal = (proposalEvents as ProposePrice[]).find(
        (proposalEvent) => this._getPriceRequestKey(proposalEvent) === key
      );
      return hasProposal === undefined;
    });
    this.unproposedPriceRequests = unproposedPriceRequests.map((event) => {
      return {
        ...event.returnValues,
        identifier: this.hexToUtf8(event.returnValues.identifier),
        ancillaryData: event.returnValues.ancillaryData ? event.returnValues.ancillaryData : "0x",
      };
    });

    // Store proposals that have NOT been disputed and have NOT been settled, and reformat data.
    const undisputedProposals = (proposalEvents as ProposePrice[]).filter((event) => {
      const key = this._getPriceRequestKey(event);
      const hasDispute = (disputeEvents as DisputePrice[]).find(
        (disputeEvent) => this._getPriceRequestKey(disputeEvent) === key
      );
      return hasDispute === undefined;
    });

    const unsettledProposals = undisputedProposals
      .map((event) => {
        const key = this._getPriceRequestKey(event);
        const settlement = settleEvents.find((settleEvent) => this._getPriceRequestKey(settleEvent) === key);
        if (settlement === undefined) {
          return {
            ...event.returnValues,
            identifier: this.hexToUtf8(event.returnValues.identifier),
            ancillaryData: event.returnValues.ancillaryData ? event.returnValues.ancillaryData : "0x",
          };
        }
      })
      .filter(isDefined);

    // Filter proposals based on their expiration timestamp:
    const currentTime = await this.oracle.methods.getCurrentTime().call();
    const isExpired = (proposal: ProposePriceReturnValues): boolean => {
      if (this.oracleType === OptimisticOracleType.SkinnyOptimisticOracle) {
        return (
          Number(
            ((((proposal as unknown) as SkinnyProposePrice["returnValues"]).request as unknown) as SkinnyRequest)
              .expirationTime
          ) <= Number(currentTime)
        );
      } else {
        return (
          Number(((proposal as unknown) as ProposePrice["returnValues"]).expirationTimestamp) <= Number(currentTime)
        );
      }
    };
    this.expiredProposals = unsettledProposals.filter((proposal) => isExpired(proposal));
    this.undisputedProposals = unsettledProposals.filter((proposal) => !isExpired(proposal));

    // Store disputes that were resolved and can be settled:
    const resolvedDisputeEvents = (
      await Promise.all(
        disputeEvents.map(async (disputeEvent) => {
          try {
            // When someone disputes an OO proposal, the OO requests a price to the DVM with a re-formatted
            // ancillary data packet that includes the original requester's information:
            const stampedAncillaryData = await this.oracle.methods
              .stampAncillaryData(
                disputeEvent.returnValues.ancillaryData ? disputeEvent.returnValues.ancillaryData : "0x",
                disputeEvent.returnValues.requester
              )
              .call();

            let timestampForDvmRequest = disputeEvent.returnValues.timestamp;
            if (this.oracleType === OptimisticOracleType.OptimisticOracleV2) {
              const request = ((await (this.oracle as OptimisticOracleV2Web3).methods
                .getRequest(
                  disputeEvent.returnValues.requester,
                  disputeEvent.returnValues.identifier,
                  disputeEvent.returnValues.timestamp,
                  disputeEvent.returnValues.ancillaryData
                )
                .call({ from: this.oracle.options.address })) as unknown) as {
                expirationTime: string;
                requestSettings: {
                  eventBased: boolean;
                  customLiveness: string;
                };
              };

              // Check if the request is an event based request
              if (request.requestSettings.eventBased) {
                // If it's an event based request then we need to calculate the timestamp for the DVM request. See
                // _getTimestampForDvmRequest function in the OptimisticOracleV2 contract for more details.
                const liveness =
                  request.requestSettings.customLiveness != "0" ? request.requestSettings.customLiveness : 7200;
                timestampForDvmRequest = String(Number(request.expirationTime) - Number(liveness)); // request.expirationTime - liveness
              }
            }

            // getPrice will return null or revert if there is no price available,
            // in which case we'll ignore this dispute.
            const resolvedPrice = revertWrapper(
              await this.voting.methods
                .getPrice(disputeEvent.returnValues.identifier, timestampForDvmRequest, stampedAncillaryData)
                .call({ from: this.oracle.options.address })
            );
            if (resolvedPrice !== null) {
              return disputeEvent;
            }
          } catch (error) {
            // No resolved price available, do nothing.
          }
        })
        // Remove undefined entries, marking disputes that did not have resolved prices
      )
    ).filter(isDefined);

    // Filter out disputes that were already settled and reformat data.
    const unsettledResolvedDisputeEvents = resolvedDisputeEvents
      .map((event) => {
        const key = this._getPriceRequestKey(event);
        const settlement = settleEvents.find((settleEvent) => this._getPriceRequestKey(settleEvent) === key);
        if (settlement === undefined) {
          return {
            ...event.returnValues,
            identifier: this.hexToUtf8(event.returnValues.identifier),
            ancillaryData: event.returnValues.ancillaryData ? event.returnValues.ancillaryData : "0x",
          };
        }
      })
      .filter(isDefined);
    this.settleableDisputes = unsettledResolvedDisputeEvents;

    // Update timestamp and end update.
    this.lastUpdateTimestamp = parseInt(currentTime);
    this.logger.debug({
      at: "OptimisticOracleClient",
      message: "Optimistic Oracle state updated",
      oracleType: this.oracleType,
      oracleAddress: this.oracle.options.address,
      lastUpdateTimestamp: this.lastUpdateTimestamp,
    });
  }
}
