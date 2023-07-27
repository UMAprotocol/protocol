import { Provider } from "@ethersproject/abstract-provider";

/**
 * Enum representing the type of an Optimistic Oracle request.
 */
export enum OptimisticOracleType {
  PriceRequest = "PriceRequest",
  Assertion = "Assertion",
}

/**
 * Interface representing the data of an Optimistic Oracle request.
 */
export interface OptimisticOracleRequestData {
  body: string; // Human-readable request body.
  type: OptimisticOracleType; // Type of the request.
  timestamp: number; // Timestamp in seconds of the request.
  identifier: string; // Identifier of the request.
  requester: string; // Address of the requester.
  requestTx: string; // Transaction hash of the request.
  proposer?: string; // Address of the proposer.
  proposedValue?: number | boolean; // Proposed value.
  proposeTx?: string; // Transaction hash of the proposal.
  disputableUntil?: number; // Timestamp in ms until the request can be disputed.
  resolvedValue?: number | boolean; // Resolved value.
  resolveTx?: string; // Transaction hash of the resolution.
  disputeTx?: string; // Transaction hash of the dispute.
}

/**
 * Represents an Optimistic Oracle request.
 */
export class OptimisticOracleRequest {
  readonly body: string; // Human-readable request body.
  readonly type: OptimisticOracleType; // Type of the request.
  readonly timestamp: number; // Timestamp in seconds of the request.
  readonly identifier: string; // Identifier of the request.
  readonly requester: string; // Address of the requester.
  readonly requestTx: string; // Transaction hash of the request.
  readonly proposer?: string; // Address of the proposer.
  readonly proposedValue?: number | boolean; // Proposed value.
  readonly proposeTx?: string; // Transaction hash of the proposal.
  readonly disputableUntil?: number; // Timestamp in ms until the request can be disputed.
  readonly resolvedValue?: number | boolean; // Resolved value.
  readonly resolveTx?: string; // Transaction hash of the resolution.
  readonly disputeTx?: string; // Transaction hash of the dispute.

  /**
   * Creates a new instance of OptimisticOracleRequest.
   * @param data The data of the request.
   */
  constructor(data: OptimisticOracleRequestData) {
    this.body = data.body;
    this.type = data.type;
    this.timestamp = data.timestamp;
    this.identifier = data.identifier;
    this.requester = data.requester;
    this.requestTx = data.requestTx;
    this.proposer = data.proposer;
    this.proposedValue = data.proposedValue;
    this.proposeTx = data.proposeTx;
    this.disputableUntil = data.disputableUntil; // should be in ms
    this.resolvedValue = data.resolvedValue;
    this.resolveTx = data.resolveTx;
    this.disputeTx = data.disputeTx;
  }
}

/**
 * Abstract class representing a client to interact with an Optimistic Oracle and store the requests.
 */
export abstract class OptimisticOracleClient<R extends OptimisticOracleRequest> {
  protected provider: Provider;
  protected requests: R[];
  protected fetchedBlockRanges: [number, number][];

  /**
   * Constructs a new instance of OptimisticOracleClient.
   * @param _provider The provider used for interacting with the blockchain.
   * @param _requests (Optional) The list of Optimistic Oracle requests.
   * @param _fetchedBlockRanges (Optional) The block ranges of the fetched requests.
   */
  protected constructor(_provider: Provider, _requests?: R[], _fetchedBlockRanges?: [number, number][]) {
    this.provider = _provider;
    this.requests = _requests || [];
    this.fetchedBlockRanges = _fetchedBlockRanges ? _fetchedBlockRanges : [];
  }

  /**
   * Creates a new instance of the OptimisticOracleClient with the specified requests.
   * Must be implemented by the derived class.
   * @param requests The requests to be set on the new instance.
   * @param fetchedBlockRange The block range of the fetched requests.
   * @returns A new instance of OptimisticOracleClient.
   */
  protected abstract createClientInstance(
    requests: R[],
    fetchedBlockRanges: [number, number][]
  ): OptimisticOracleClient<R>;

  /**
   * Retrieves Optimistic Oracle requests within the specified block range.
   * @param blockRange The block range to fetch requests from.
   * @returns A Promise that resolves to an array of OptimisticOracleRequest objects.
   */
  protected abstract fetchOracleRequests(blockRange: [number, number]): Promise<R[]>;

  /**
   * Updates the OptimisticOracleClient instance by fetching new Oracle requests within the specified block range. Returns a new instance.
   * @param blockRange (Optional) The block range to fetch new requests from.
   * @returns A Promise that resolves to a new OptimisticOracleClient instance with updated requests.
   */
  async updateWithBlockRange(blockRange?: [number, number]): Promise<this> {
    let range: [number, number];
    if (blockRange) {
      if (blockRange[0] > blockRange[1]) throw new Error("Invalid block range");
      range = blockRange;
    } else {
      // Calculate the next block range to fetch
      const latestBlock = await this.provider.getBlockNumber();
      const lastFetchedRange = this.fetchedBlockRanges[this.fetchedBlockRanges.length - 1];
      const nextStartBlock = lastFetchedRange[1] + 1;
      if (nextStartBlock > latestBlock) return this; // no new blocks to fetch
      range = [nextStartBlock, latestBlock];
    }
    const [startBlock, endBlock] = range;
    if (
      this.fetchedBlockRanges.some(([s, e]) => (s <= startBlock && startBlock <= e) || (s <= endBlock && endBlock <= e))
    )
      throw new Error("Block range already fetched");

    // Add new range to the list of fetched ranges and sort them by start block number
    const newRanges = [...this.fetchedBlockRanges, range].sort(([s1], [s2]) => s1 - s2);

    const newRequests = await this.fetchOracleRequests(range);

    return this.createClientInstance([...this.requests, ...newRequests], newRanges) as this;
  }

  /**
   * Returns the list of Optimistic Oracle requests.
   * @returns An array of OptimisticOracleRequest objects.
   */
  getRequests(): R[] {
    return this.requests || [];
  }

  /**
   * Returns the block ranges of the fetched requests.
   * @returns An array of pairs of numbers representing the block ranges.
   */
  getFetchedBlockRange(): [number, number][] {
    return this.fetchedBlockRanges;
  }

  /**
   * Returns the provider used for interacting with the blockchain.
   * @returns The provider object.
   */
  getProvider(): Provider {
    return this.provider;
  }
}

/**
 * Represents a filtering strategy for an Optimistic Oracle client price requests.
 * @template I The type of the input OptimisticOracleRequest.
 * @template O The type of the output OptimisticOracleRequest.
 */
export interface OptimisticOracleClientFilter<I extends OptimisticOracleRequest, O extends OptimisticOracleRequest> {
  /**
   * Filters and/or augments Optimistic Oracle requests.
   * @param optimisticOracleRequests The Optimistic Oracle requests to be filtered.
   * @returns A Promise that resolves to the filtered Optimistic Oracle requests.
   */
  filter(optimisticOracleRequests: I[]): Promise<O[]>;
}
