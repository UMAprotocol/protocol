import { Provider } from "@ethersproject/abstract-provider";
import { ethers } from "ethers";
import { cloneDeep } from "lodash";

/**
 * Calculate the unique ID for a request.
 * @param body The body of the request.
 * @param identifier The identifier of the request.
 * @param timestamp The timestamp of the request.
 * @param requester The address of the requester.
 * @returns The unique ID.
 */
export function calculateRequestId(body: string, identifier: string, timestamp: number, requester: string): string {
  return ethers.utils.solidityKeccak256(
    ["string", "string", "uint256", "string"],
    [body, identifier, timestamp, requester]
  );
}

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
  isEventBased: boolean; // Whether the request is event based.
  identifier: string; // Identifier of the request.
  requester: string; // Address of the requester.
  requestTx: string; // Transaction hash of the request.
  blockNumber: number; // Block number of the request update.
  transactionIndex: number; // Transaction index in the block.
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
  readonly isEventBased: boolean; // Whether the request is event based.
  readonly identifier: string; // Identifier of the request.
  readonly requester: string; // Address of the requester.
  readonly requestTx: string; // Transaction hash of the request.
  blockNumber: number; // Block number of the request update.
  transactionIndex: number; // Transaction index in the block.
  proposer?: string; // Address of the proposer.
  proposedValue?: number | boolean; // Proposed value.
  proposeTx?: string; // Transaction hash of the proposal.
  disputableUntil?: number; // Timestamp in ms until the request can be disputed.
  resolvedValue?: number | boolean; // Resolved value.
  resolveTx?: string; // Transaction hash of the resolution.
  disputeTx?: string; // Transaction hash of the dispute.

  /**
   * Creates a new instance of OptimisticOracleRequest.
   * @param data The data of the request.
   */
  constructor(data: OptimisticOracleRequestData) {
    this.body = data.body;
    this.type = data.type;
    this.timestamp = data.timestamp;
    this.isEventBased = data.isEventBased;
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
    this.blockNumber = data.blockNumber;
    this.transactionIndex = data.transactionIndex;
  }

  getId(): string {
    return calculateRequestId(this.body, this.identifier, this.timestamp, this.requester);
  }

  setProposer(proposer: string): void {
    this.proposer = proposer;
  }

  setProposedValue(proposedValue: number | boolean): void {
    this.proposedValue = proposedValue;
  }

  setProposeTx(proposeTx: string): void {
    this.proposeTx = proposeTx;
  }

  setDisputableUntil(disputableUntil: number): void {
    this.disputableUntil = disputableUntil;
  }

  setResolvedValue(resolvedValue: number | boolean): void {
    this.resolvedValue = resolvedValue;
  }

  setResolveTx(resolveTx: string): void {
    this.resolveTx = resolveTx;
  }

  setDisputeTx(disputeTx: string): void {
    this.disputeTx = disputeTx;
  }

  setBlockNumber(blockNumber: number): void {
    this.blockNumber = blockNumber;
  }

  setTransactionIndex(transactionIndex: number): void {
    this.transactionIndex = transactionIndex;
  }
}

/**
 * Abstract class representing a client to interact with an Optimistic Oracle and store the requests.
 */
export abstract class OptimisticOracleClient<R extends OptimisticOracleRequest> {
  protected provider: Provider;
  readonly requests: Map<string, R>;
  protected fetchedBlockRanges: [number, number][];

  /**
   * Constructs a new instance of OptimisticOracleClient.
   * @param _provider The provider used for interacting with the blockchain.
   * @param _requests (Optional) The map of Optimistic Oracle requests.
   * @param _fetchedBlockRanges (Optional) The block ranges of the fetched requests.
   * @dev requests are stored in a map for faster access and to avoid duplicates.
   */
  protected constructor(
    _provider: Provider,
    _requests: Map<string, R> = new Map(),
    _fetchedBlockRanges: [number, number][] = [[0, 0]]
  ) {
    this.provider = _provider;
    this.requests = _requests;
    this.fetchedBlockRanges = _fetchedBlockRanges;
  }

  /**
   * Returns a copy of the requests.
   * @returns A copy of the requests.
   * @dev This is a deep copy.
   */
  getRequestsCopy(): Map<string, R> {
    return cloneDeep(this.requests);
  }

  /**
   * Returns a copy of the OptimisticOracleClient
   * @returns A copy of the OptimisticOracleClient
   * @dev This is a deep copy.
   */
  copy(): OptimisticOracleClient<R> {
    return this.createClientInstance(this.getRequestsCopy(), this.fetchedBlockRanges);
  }

  /**
   * Creates a new instance of the OptimisticOracleClient with the specified requests.
   * Must be implemented by the derived class.
   * @param requests The requests to be set on the new instance.
   * @param fetchedBlockRange The block range of the fetched requests.
   * @returns A new instance of OptimisticOracleClient.
   */
  protected abstract createClientInstance(
    requests: Map<string, R>,
    fetchedBlockRanges: [number, number][]
  ): OptimisticOracleClient<R>;

  /**
   * Updates the OptimisticOracleClient instance by fetching new Oracle requests updates and storing them in the requests map.
   * @param blockRanges The new blockRanges to fetch requests from.
   */
  protected abstract updateOracleRequests(blockRanges: [number, number][]): Promise<void>;

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

    // Throw an error if the new range doesn't directly follow the last fetched range
    const lastFetchedEndBlock = this.fetchedBlockRanges[this.fetchedBlockRanges.length - 1][1];
    if (lastFetchedEndBlock != 0 && startBlock !== lastFetchedEndBlock + 1)
      throw new Error(
        "New block range does not follow the last fetched block range, there is a gap between the ranges"
      );

    if (
      this.fetchedBlockRanges.some(([s, e]) => (s <= startBlock && startBlock <= e) || (s <= endBlock && endBlock <= e))
    )
      throw new Error("Block range already fetched");

    // We enforce the creation of a new instance of the client to avoid mutating the current instance
    const newClient = this.copy();
    const newRanges = [...this.fetchedBlockRanges, range];
    await newClient.updateOracleRequests(newRanges);

    return newClient as this;
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
