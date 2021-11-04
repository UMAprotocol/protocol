// A thick client for getting information about an OptimisticOracle. Used to get price requests and
// proposals, which can be disputed and settled.
import { averageBlockTimeSeconds, revertWrapper } from "@uma/common";
import Web3 from "web3";
import type { Logger } from "winston";
import { Abi, isDefined } from "../types";
import {
  SkinnyOptimisticOracleWeb3,
  OptimisticOracleWeb3,
  VotingAncillaryInterfaceTestingWeb3,
  OptimisticOracleWeb3Events,
  SkinnyOptimisticOracleWeb3Events,
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

type OptimisticOracleContract = SkinnyOptimisticOracleWeb3 | OptimisticOracleWeb3;

export enum OptimisticOracleType {
  OptimisticOracle,
  SkinnyOptimisticOracle,
}
export class OptimisticOracleClient {
  public readonly oracle: OptimisticOracleContract;
  public readonly voting: VotingAncillaryInterfaceTestingWeb3;

  // Store the last on-chain time the clients were updated to inform price request information.
  private lastUpdateTimestamp = 0;
  private hexToUtf8 = Web3.utils.hexToUtf8;

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
   * @param {OptimisticOracleType} oracleType Index of allowed OptimisticOracle types.
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
    public readonly oracleType: OptimisticOracleType = OptimisticOracleType.OptimisticOracle
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
  public getSettleableProposals(caller: string): ProposePriceReturnValues[] {
    if (this.oracleType === OptimisticOracleType.SkinnyOptimisticOracle) {
      return (this.expiredProposals as SkinnyProposePrice["returnValues"][]).filter((event) => {
        return ((event.request as unknown) as SkinnyRequest).proposer === caller;
      });
    } else {
      return ((this.expiredProposals as unknown) as ProposePrice["returnValues"][]).filter((event) => {
        return event.proposer === caller;
      });
    }
  }

  // Returns disputes that can be settled and that involved the caller as the disputer
  public getSettleableDisputes(caller: string): DisputePriceReturnValues[] {
    if (this.oracleType === OptimisticOracleType.SkinnyOptimisticOracle) {
      return (this.settleableDisputes as SkinnyDisputePrice["returnValues"][]).filter((event) => {
        return ((event.request as unknown) as SkinnyRequest).disputer === caller;
      });
    } else {
      return (this.settleableDisputes as DisputePrice["returnValues"][]).filter((event) => {
        return event.disputer === caller;
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
    const [averageBlockTime, currentBlock] = await Promise.all([
      averageBlockTimeSeconds(),
      this.web3.eth.getBlock("latest"),
    ]);
    const lookbackBlocks = Math.ceil(this.lookback / averageBlockTime);
    const earliestBlockToQuery = Math.max(currentBlock.number - lookbackBlocks, 0);

    // Fetch contract state variables in parallel.
    // Note: We can treat all events by default as normal OptimisticOracle events because in most cases we only
    // need to read the requester, identifier, timestamp, and ancillary data which are emitted in both Skinny
    // and normal OptimisticOracle events.
    const [requestEvents, proposalEvents, disputeEvents, settleEvents, currentTime] = await Promise.all([
      (this.oracle.getPastEvents("RequestPrice", { fromBlock: earliestBlockToQuery }) as unknown) as Promise<
        RequestPrice[] | SkinnyRequestPrice[]
      >,
      (this.oracle.getPastEvents("ProposePrice", { fromBlock: earliestBlockToQuery }) as unknown) as Promise<
        ProposePrice[] | SkinnyProposePrice[]
      >,
      (this.oracle.getPastEvents("DisputePrice", { fromBlock: earliestBlockToQuery }) as unknown) as Promise<
        DisputePrice[] | SkinnyDisputePrice[]
      >,
      (this.oracle.getPastEvents("Settle", { fromBlock: earliestBlockToQuery }) as unknown) as Promise<
        Settle[] | SkinnySettle[]
      >,
      this.oracle.methods.getCurrentTime().call(),
    ]);

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

            // getPrice will return null or revert if there is no price available,
            // in which case we'll ignore this dispute.
            const resolvedPrice = revertWrapper(
              await this.voting.methods
                .getPrice(
                  disputeEvent.returnValues.identifier,
                  disputeEvent.returnValues.timestamp,
                  stampedAncillaryData
                )
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
      oracleType: OptimisticOracleType[this.oracleType],
      oracleAddress: this.oracle.options.address,
      lastUpdateTimestamp: this.lastUpdateTimestamp,
    });
  }
}
