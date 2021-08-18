// A thick client for getting information about an OptimisticOracle. Used to get price requests and
// proposals, which can be disputed and settled.
import { averageBlockTimeSeconds, revertWrapper, OptimisticOracleRequestStatesEnum } from "@uma/common";
import Web3 from "web3";
import type { Logger } from "winston";
import { Abi } from "../types";
import {
  OptimisticOracleWeb3,
  VotingAncillaryInterfaceTestingWeb3,
  OptimisticOracleWeb3Events,
} from "@uma/contracts-node";

type RequestPrice = OptimisticOracleWeb3Events.RequestPrice["returnValues"];
type ProposePrice = OptimisticOracleWeb3Events.ProposePrice["returnValues"];
type DisputePrice = OptimisticOracleWeb3Events.DisputePrice["returnValues"];

export class OptimisticOracleClient {
  public readonly oracle: OptimisticOracleWeb3;
  public readonly voting: VotingAncillaryInterfaceTestingWeb3;

  // Store the last on-chain time the clients were updated to inform price request information.
  private lastUpdateTimestamp = 0;
  private hexToUtf8 = Web3.utils.hexToUtf8;

  // Oracle Data structures & values to enable synchronous returns of the state seen by the client.
  private unproposedPriceRequests: RequestPrice[] = [];
  private undisputedProposals: ProposePrice[] = [];
  private expiredProposals: ProposePrice[] = [];
  private settleableDisputes: DisputePrice[] = [];

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
   * @return None or throws an Error.
   */
  constructor(
    private readonly logger: Logger,
    oracleAbi: Abi,
    votingAbi: Abi,
    public readonly web3: Web3,
    oracleAddress: string,
    votingAddress: string,
    public readonly lookback = 604800 // 1 Week
  ) {
    // Optimistic Oracle contract:
    this.oracle = (new web3.eth.Contract(oracleAbi, oracleAddress) as unknown) as OptimisticOracleWeb3;

    // Voting contract we'll use to determine whether OO disputes can be settled:
    this.voting = (new web3.eth.Contract(votingAbi, votingAddress) as unknown) as VotingAncillaryInterfaceTestingWeb3;

    // Oracle Data structures & values to enable synchronous returns of the state seen by the client.
    this.unproposedPriceRequests = [];
    this.undisputedProposals = [];
    this.expiredProposals = [];
    this.settleableDisputes = [];
  }

  // Returns an array of Price Requests that have no proposals yet.
  getUnproposedPriceRequests(): RequestPrice[] {
    return this.unproposedPriceRequests;
  }

  // Returns an array of Price Proposals that have not been disputed.
  getUndisputedProposals(): ProposePrice[] {
    return this.undisputedProposals;
  }

  // Returns an array of expired Price Proposals that can be settled and that involved
  // the caller as the proposer
  getSettleableProposals(caller: string): ProposePrice[] {
    return this.expiredProposals.filter((event) => {
      return event.proposer === caller;
    });
  }

  // Returns disputes that can be settled and that involved the caller as the disputer
  getSettleableDisputes(caller: string): DisputePrice[] {
    return this.settleableDisputes.filter((event) => {
      return event.disputer === caller;
    });
  }

  // Returns the last update timestamp.
  getLastUpdateTime() {
    return this.lastUpdateTimestamp;
  }

  _getPriceRequestKey(reqEvent: OptimisticOracleWeb3Events.RequestPrice): string {
    return `${reqEvent.returnValues.requester}-${reqEvent.returnValues.identifier}-${reqEvent.returnValues.timestamp}-${reqEvent.returnValues.ancillaryData}`;
  }

  async update(): Promise<void> {
    // Determine earliest block to query events for based on lookback window:
    const [averageBlockTime, currentBlock] = await Promise.all([
      averageBlockTimeSeconds(),
      this.web3.eth.getBlock("latest"),
    ]);
    const lookbackBlocks = Math.ceil(this.lookback / averageBlockTime);
    const earliestBlockToQuery = Math.max(currentBlock.number - lookbackBlocks, 0);

    // Fetch contract state variables in parallel.
    const [requestEvents, proposalEvents, disputeEvents, currentTime] = await Promise.all([
      (this.oracle.getPastEvents("RequestPrice", { fromBlock: earliestBlockToQuery }) as unknown) as Promise<
        OptimisticOracleWeb3Events.RequestPrice[]
      >,
      (this.oracle.getPastEvents("ProposePrice", { fromBlock: earliestBlockToQuery }) as unknown) as Promise<
        OptimisticOracleWeb3Events.ProposePrice[]
      >,
      (this.oracle.getPastEvents("DisputePrice", { fromBlock: earliestBlockToQuery }) as unknown) as Promise<
        OptimisticOracleWeb3Events.DisputePrice[]
      >,
      this.oracle.methods.getCurrentTime().call(),
    ]);

    // Store price requests that have NOT been proposed to yet:
    const unproposedPriceRequests = requestEvents.filter((event) => {
      const key = this._getPriceRequestKey(event);
      const hasProposal = proposalEvents.find((proposalEvent) => this._getPriceRequestKey(proposalEvent) === key);
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
    const undisputedProposals = proposalEvents.filter((event) => {
      const key = this._getPriceRequestKey(event);
      const hasDispute = disputeEvents.find((disputeEvent) => this._getPriceRequestKey(disputeEvent) === key);
      return hasDispute === undefined;
    });

    const isDefined = <T>(element: T | undefined): element is T => {
      return element !== undefined;
    };

    const unsettledProposals = (
      await Promise.all(
        undisputedProposals.map(async (event) => {
          const state = await this.oracle.methods
            .getState(
              event.returnValues.requester,
              event.returnValues.identifier,
              event.returnValues.timestamp,
              event.returnValues.ancillaryData ? event.returnValues.ancillaryData : "0x"
            )
            .call();

          // For unsettled proposals, reformat the data:
          if (state !== OptimisticOracleRequestStatesEnum.SETTLED) {
            return {
              ...event.returnValues,
              identifier: this.hexToUtf8(event.returnValues.identifier),
              ancillaryData: event.returnValues.ancillaryData ? event.returnValues.ancillaryData : "0x",
            };
          }
        })
      )
    ).filter(isDefined);

    // Filter proposals based on their expiration timestamp:
    const isExpired = (proposal: OptimisticOracleWeb3Events.ProposePrice["returnValues"]) => {
      return Number(proposal.expirationTimestamp) <= Number(currentTime);
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
    const unsettledResolvedDisputeEvents = (
      await Promise.all(
        resolvedDisputeEvents.map(async (event) => {
          const state = await this.oracle.methods
            .getState(
              event.returnValues.requester,
              event.returnValues.identifier,
              event.returnValues.timestamp,
              event.returnValues.ancillaryData ? event.returnValues.ancillaryData : "0x"
            )
            .call();

          // For unsettled disputes, reformat the data:
          if (state !== OptimisticOracleRequestStatesEnum.SETTLED) {
            return {
              ...event.returnValues,
              identifier: this.hexToUtf8(event.returnValues.identifier),
              ancillaryData: event.returnValues.ancillaryData ? event.returnValues.ancillaryData : "0x",
            };
          }
        })
      )
    ).filter(isDefined);
    this.settleableDisputes = unsettledResolvedDisputeEvents;

    // Update timestamp and end update.
    this.lastUpdateTimestamp = parseInt(currentTime);
    this.logger.debug({
      at: "OptimisticOracleClient",
      message: "Optimistic Oracle state updated",
      lastUpdateTimestamp: this.lastUpdateTimestamp,
    });
  }
}
