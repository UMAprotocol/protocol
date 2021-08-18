import Web3 from "web3";
import { Logger } from "winston";
import { OptimisticOracleWeb3, OptimisticOracleWeb3Events } from "@uma/contracts-node";
import { Abi } from "../types";

interface TransactionMetadata {
  transactionHash: string;
  blockNumber: number;
}

type EventExport<T extends { returnValues: any }> = T["returnValues"] & TransactionMetadata;

type RequestPrice = EventExport<OptimisticOracleWeb3Events.RequestPrice>;
type ProposePrice = EventExport<OptimisticOracleWeb3Events.ProposePrice>;
type DisputePrice = EventExport<OptimisticOracleWeb3Events.DisputePrice> & { currency: string };
type Settle = EventExport<OptimisticOracleWeb3Events.Settle> & { currency: string };

// A thick client for getting information about OptimisticOracle events. This client is kept separate from the
// OptimisticOracleClient to keep a clear separation of concerns and to limit the overhead from querying the chain.

export class OptimisticOracleEventClient {
  // OptimisticOracle contract
  public optimisticOracleContract: OptimisticOracleWeb3;

  // OptimisticOracle Contract Events data structure to enable synchronous retrieval of information.
  private requestPriceEvents: RequestPrice[] = [];
  private proposePriceEvents: ProposePrice[] = [];
  private disputePriceEvents: DisputePrice[] = [];
  private settlementEvents: Settle[] = [];

  // First block number to begin searching for events after.
  private firstBlockToSearch: number;

  // Last block number to end the searching for events at.
  private lastBlockToSearchUntil: number | null;

  private lastUpdateTimestamp = 0;

  private hexToUtf8 = Web3.utils.hexToUtf8;

  /**
   * @notice Constructs new OptimisticOracleEventClient.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} optimisticOracleAbi OptimisticOracle truffle ABI object to create a contract instance.
   * @param {Object} web3 Web3 provider from truffle instance.
   * @param {String} optimisticOracleAddress Ethereum address of the OptimisticOracle contract deployed on the current network.
   * @param {Integer} startingBlockNumber Offset block number to index events from.
   * @param {Integer} endingBlockNumber Termination block number to index events until. If not defined runs to `latest`.
   * @return None or throws an Error.
   */
  constructor(
    private readonly logger: Logger,
    optimisticOracleAbi: Abi,
    public readonly web3: Web3,
    optimisticOracleAddress: string,
    startingBlockNumber = 0,
    endingBlockNumber: number | null = null
  ) {
    this.optimisticOracleContract = (new this.web3.eth.Contract(
      optimisticOracleAbi,
      optimisticOracleAddress
    ) as unknown) as OptimisticOracleWeb3;
    this.firstBlockToSearch = startingBlockNumber;
    this.lastBlockToSearchUntil = endingBlockNumber;
  }
  // Delete all events within the client
  async clearState(): Promise<void> {
    this.requestPriceEvents = [];
    this.proposePriceEvents = [];
    this.disputePriceEvents = [];
    this.settlementEvents = [];
  }

  getAllRequestPriceEvents(): RequestPrice[] {
    return this.requestPriceEvents;
  }

  getAllProposePriceEvents(): ProposePrice[] {
    return this.proposePriceEvents;
  }

  getAllDisputePriceEvents(): DisputePrice[] {
    return this.disputePriceEvents;
  }

  getAllSettlementEvents(): Settle[] {
    return this.settlementEvents;
  }

  // Returns the last update timestamp.
  getLastUpdateTime(): number {
    return this.lastUpdateTimestamp;
  }

  async update(): Promise<void> {
    // The last block to search is either the value specified in the constructor (useful in serverless mode) or is the
    // latest block number (if running in loop mode).
    // Set the last block to search up until.
    const lastBlockToSearch = this.lastBlockToSearchUntil
      ? this.lastBlockToSearchUntil
      : await this.web3.eth.getBlockNumber();

    // Define a config to bound the queries by.
    const blockSearchConfig = { fromBlock: this.firstBlockToSearch, toBlock: lastBlockToSearch };

    // Look for events on chain from the previous seen block number to the current block number.
    const [
      currentTime,
      requestPriceEventsObj,
      proposePriceEventsObj,
      disputePriceEventsObj,
      settlementEventsObj,
    ] = await Promise.all([
      this.optimisticOracleContract.methods.getCurrentTime().call(),
      (this.optimisticOracleContract.getPastEvents("RequestPrice", blockSearchConfig) as unknown) as Promise<
        OptimisticOracleWeb3Events.RequestPrice[]
      >,
      (this.optimisticOracleContract.getPastEvents("ProposePrice", blockSearchConfig) as unknown) as Promise<
        OptimisticOracleWeb3Events.ProposePrice[]
      >,
      (this.optimisticOracleContract.getPastEvents("DisputePrice", blockSearchConfig) as unknown) as Promise<
        OptimisticOracleWeb3Events.DisputePrice[]
      >,
      (this.optimisticOracleContract.getPastEvents("Settle", blockSearchConfig) as unknown) as Promise<
        OptimisticOracleWeb3Events.Settle[]
      >,
    ]);
    // Set the current contract time as the last update timestamp from the contract.
    this.lastUpdateTimestamp = parseInt(currentTime);

    // Process the responses into clean objects.
    // RequestPrice events.
    for (const event of requestPriceEventsObj) {
      this.requestPriceEvents.push({
        ...event.returnValues,
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        identifier: this.hexToUtf8(event.returnValues.identifier),
        ancillaryData: event.returnValues.ancillaryData ? event.returnValues.ancillaryData : "0x",
      });
    }

    // ProposePrice events.
    for (const event of proposePriceEventsObj) {
      this.proposePriceEvents.push({
        ...event.returnValues,
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        identifier: this.hexToUtf8(event.returnValues.identifier),
        ancillaryData: event.returnValues.ancillaryData ? event.returnValues.ancillaryData : "0x",
      });
    }

    // DisputePrice events.
    for (const event of disputePriceEventsObj) {
      // The OptimisticOracle contract should ideally emit `currency` as part of this event, but alternatively we can
      // query the currency address on-chain.
      const requestData = await this._getRequestData(
        event.returnValues.requester,
        event.returnValues.identifier,
        event.returnValues.timestamp,
        event.returnValues.ancillaryData
      );
      this.disputePriceEvents.push({
        ...event.returnValues,
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        identifier: this.hexToUtf8(event.returnValues.identifier),
        ancillaryData: event.returnValues.ancillaryData ? event.returnValues.ancillaryData : "0x",
        currency: requestData.currency,
      });
    }

    // Settlement events.
    for (const event of settlementEventsObj) {
      // See explanation above in disputeEventsObj loop.
      const requestData = await this._getRequestData(
        event.returnValues.requester,
        event.returnValues.identifier,
        event.returnValues.timestamp,
        event.returnValues.ancillaryData
      );
      this.settlementEvents.push({
        ...event.returnValues,
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        identifier: this.hexToUtf8(event.returnValues.identifier),
        ancillaryData: event.returnValues.ancillaryData ? event.returnValues.ancillaryData : "0x",
        currency: requestData.currency,
      });
    }

    // Add 1 to current block so that we do not double count the last block number seen.
    this.firstBlockToSearch = lastBlockToSearch + 1;

    this.logger.debug({
      at: "OptimisticOracleEventClient",
      message: "Optimistic Oracle event state updated",
      lastUpdateTimestamp: this.lastUpdateTimestamp,
    });
  }

  private async _getRequestData(
    requester: string,
    identifier: string,
    timestamp: string,
    ancillaryData: string | null | undefined
  ) {
    return await ((this.optimisticOracleContract.methods
      .getRequest(requester, identifier, timestamp, ancillaryData || "0x")
      .call() as unknown) as ReturnType<ReturnType<OptimisticOracleWeb3["methods"]["requests"]>["call"]>);
  }
}
