import { Provider } from "@ethersproject/abstract-provider";
import { ethers } from "ethers";

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
 * Type representing a block range.
 */
export type BlockRange = [number, number];

/**
 * Enum representing the type of an Optimistic Oracle request.
 */
export enum OptimisticOracleType {
  PriceRequest = "PriceRequest",
  Assertion = "Assertion",
}

interface RequestData {
  readonly body: string; // Human-readable request body.
  readonly type: OptimisticOracleType; // Type of the request.
  readonly timestamp: number; // Timestamp in seconds of the request.
  readonly isEventBased: boolean; // Whether the request is event based.
  readonly identifier: string; // Identifier of the request.
  readonly requester: string; // Address of the requester.
  readonly requestTx: string; // Transaction hash of the request.
  readonly blockNumber: number; // Block number of the request update.
  readonly transactionIndex: number; // Transaction index in the block.
}

interface ProposalData {
  readonly proposer: string; // Address of the proposer.
  readonly proposedValue: number | boolean; // Proposed value.
  readonly proposeTx: string; // Transaction hash of the proposal.
  readonly disputableUntil: number; // Timestamp in ms until the request can be disputed.
}

interface ResolutionData {
  readonly resolvedValue?: number | boolean; // Resolved value.
  readonly resolveTx: string; // Transaction hash of the resolution.
  readonly disputeTx: string; // Transaction hash of the dispute.
}

/**
 * Interface representing the data of an Optimistic Oracle request.
 * Note: this is structured to reduce replication and copying of data by storing the request data, proposal data, and resolution data in separate
 * references.
 */
export interface OptimisticOracleRequestData {
  readonly requestData: RequestData;
  readonly proposalData?: ProposalData;
  readonly resolutionData?: ResolutionData;
}

/**
 * Represents an Optimistic Oracle request.
 */
export class OptimisticOracleRequest {
  /**
   * Creates a new instance of OptimisticOracleRequest.
   * @param data The data of the request.
   */
  constructor(readonly data: OptimisticOracleRequestData) {}

  get body(): string {
    return this.data.requestData.body;
  }

  get type(): OptimisticOracleType {
    return this.data.requestData.type;
  }

  get timestamp(): number {
    return this.data.requestData.timestamp;
  }

  get isEventBased(): boolean {
    return this.data.requestData.isEventBased;
  }

  get identifier(): string {
    return this.data.requestData.identifier;
  }

  get requester(): string {
    return this.data.requestData.requester;
  }

  get requestTx(): string {
    return this.data.requestData.requestTx;
  }

  get proposer(): string | undefined {
    return this.data.proposalData?.proposer;
  }

  get proposedValue(): number | boolean | undefined {
    return this.data.proposalData?.proposedValue;
  }

  get proposeTx(): string | undefined {
    return this.data.proposalData?.proposeTx;
  }

  get disputableUntil(): number | undefined {
    return this.data.proposalData?.disputableUntil;
  }

  get resolvedValue(): number | boolean | undefined {
    return this.data.resolutionData?.resolvedValue;
  }

  get resolveTx(): string | undefined {
    return this.data.resolutionData?.resolveTx;
  }

  get disputeTx(): string | undefined {
    return this.data.resolutionData?.disputeTx;
  }

  get blockNumber(): number | undefined {
    return this.data.requestData.blockNumber;
  }

  get transactionIndex(): number | undefined {
    return this.data.requestData.transactionIndex;
  }

  get id(): string {
    return calculateRequestId(this.body, this.identifier, this.timestamp, this.requester);
  }

  update(data: Partial<OptimisticOracleRequestData>): OptimisticOracleRequest {
    // Override old data with new data. Note: this will only copy or override top-level properties.
    return new OptimisticOracleRequest({ ...this.data, ...data });
  }
}

const EMPTY_BLOCK_RANGE: BlockRange = [0, 0];

/**
 * Abstract class representing a client to interact with an Optimistic Oracle and store the requests.
 */
export abstract class OptimisticOracleClient<R extends OptimisticOracleRequest> {
  protected provider: Provider;
  readonly requests: Map<string, R>;
  protected fetchedBlockRanges: BlockRange[];

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
    _fetchedBlockRanges: BlockRange[] = [EMPTY_BLOCK_RANGE]
  ) {
    this.provider = _provider;
    this.requests = _requests;
    this.fetchedBlockRanges = _fetchedBlockRanges;
  }

  /**
   * Returns a copy of the OptimisticOracleClient
   * @returns A copy of the OptimisticOracleClient
   * @dev This is a deep copy.
   */
  copy(): OptimisticOracleClient<R> {
    return this.createClientInstance(new Map(this.requests), this.fetchedBlockRanges);
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
    fetchedBlockRanges: BlockRange[]
  ): OptimisticOracleClient<R>;

  /**
   * Updates the OptimisticOracleClient instance by fetching new Oracle requests updates and storing them in the requests map.
   * @param blockRanges The new blockRanges to fetch requests from.
   */
  protected abstract updateOracleRequests(blockRanges: BlockRange[]): Promise<void>;

  /**
   * Updates the OptimisticOracleClient instance by fetching new Oracle requests within the specified block range. Returns a new instance.
   * @param blockRange (Optional) The block range to fetch new requests from.
   * @returns A Promise that resolves to a new OptimisticOracleClient instance with updated requests.
   */
  async updateWithBlockRange(blockRange?: BlockRange): Promise<this> {
    let range: BlockRange;
    if (blockRange) {
      if (blockRange[0] > blockRange[1])
        throw new Error("Start block number should be less than or equal to end block number");
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
  getFetchedBlockRange(): BlockRange[] {
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
