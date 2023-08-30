import { Provider } from "@ethersproject/abstract-provider";
import { BigNumber, ethers } from "ethers";
import { OptimisticOracleV2Ethers } from "@uma/contracts-node";

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
  readonly rawBody: string; // Raw request body.
  readonly type: OptimisticOracleType; // Type of the request.
  readonly timestamp: number; // Timestamp in seconds of the request.
  readonly identifier: string; // Identifier of the request.
  readonly requester: string; // Address of the requester.
  readonly requestTx: string; // Transaction hash of the request.
  readonly blockNumber: number; // Block number of the request update.
  readonly transactionIndex: number; // Transaction index in the block.
}

interface ProposalData {
  readonly proposer: string; // Address of the proposer.
  readonly proposedValue: BigNumber | boolean; // Proposed value.
  readonly proposeTx: string; // Transaction hash of the proposal.
  readonly disputableUntil: number; // Timestamp in seconds until the request can be disputed.
}

interface DisputeData {
  readonly disputer: string; // Address of the disputer.
  readonly disputeTx: string; // Transaction hash of the dispute.
}

interface ResolutionData {
  readonly resolvedValue: BigNumber | boolean; // Resolved value.
  readonly resolveTx: string; // Transaction hash of the resolution.
}

/**
 * Interface representing the data of an Optimistic Oracle request.
 * Note: this is structured to reduce replication and copying of data by storing the request data, proposal data, and resolution data in separate
 * references.
 */
export interface OptimisticOracleRequestData {
  readonly requestData: RequestData;
  readonly proposalData?: ProposalData;
  readonly disputeData?: DisputeData;
  readonly resolutionData?: ResolutionData;
}

/**
 * Represents an Optimistic Oracle request.
 */
export class OptimisticOracleRequest {
  protected isEventBased = false; // Whether the request is event-based. False by default and eventually only true if
  // the request is a OptimisticOracleV2 priceRequest.
  /**
   * Creates a new instance of OptimisticOracleRequest.
   * @param data The data of the request.
   */
  constructor(readonly data: OptimisticOracleRequestData) {}

  async fetchIsEventBased(ooV2Contract: OptimisticOracleV2Ethers): Promise<boolean> {
    if (this.type !== OptimisticOracleType.PriceRequest) return Promise.resolve(false);

    if (this.isEventBased) return Promise.resolve(this.isEventBased);

    this.isEventBased = await ooV2Contract
      .getRequest(
        this.data.requestData.requester,
        this.data.requestData.identifier,
        this.data.requestData.timestamp,
        this.data.requestData.rawBody
      )
      .then((r) => r.requestSettings.eventBased);
    return this.isEventBased;
  }

  get body(): string {
    return this.data.requestData.body;
  }

  get type(): OptimisticOracleType {
    return this.data.requestData.type;
  }

  get timestamp(): number {
    return this.data.requestData.timestamp;
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

  get proposedValue(): BigNumber | boolean | undefined {
    return this.data.proposalData?.proposedValue;
  }

  get proposeTx(): string | undefined {
    return this.data.proposalData?.proposeTx;
  }

  get disputableUntil(): number | undefined {
    return this.data.proposalData?.disputableUntil;
  }

  get resolvedValue(): BigNumber | boolean | undefined {
    return this.data.resolutionData?.resolvedValue;
  }

  get resolveTx(): string | undefined {
    return this.data.resolutionData?.resolveTx;
  }

  get disputeTx(): string | undefined {
    return this.data.disputeData?.disputeTx;
  }

  get disputer(): string | undefined {
    return this.data.disputeData?.disputer;
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

/**
 * Interface representing the additional data fields for a disputable oracle request.
 */
interface DisputableData {
  correctAnswer: boolean | BigNumber;
  rawLLMInput: string;
  rawLLMOutput: string;
  shouldDispute: boolean;
}

/**
 * Interface extending the base oracle request data to include disputable data.
 */
export interface OptimisticOracleRequestDisputableData extends OptimisticOracleRequestData {
  readonly disputableData: DisputableData;
}

/**
 * Class representing an oracle request that can potentially be disputed.
 * It extends the base OptimisticOracleRequest class and includes additional disputable data.
 */
export class OptimisticOracleRequestDisputable extends OptimisticOracleRequest {
  constructor(readonly data: OptimisticOracleRequestDisputableData) {
    super(data);
  }

  get correctAnswer(): boolean | BigNumber {
    return this.data.disputableData.correctAnswer;
  }

  get rawLLMInput(): string {
    return this.data.disputableData.rawLLMInput;
  }

  get rawLLMOutput(): string {
    return this.data.disputableData.rawLLMOutput;
  }

  get shouldDispute(): boolean {
    return this.data.disputableData.shouldDispute;
  }

  get isDisputable(): boolean {
    return this.disputableUntil !== undefined && this.disputableUntil > Date.now() / 1000;
  }
}

const EMPTY_BLOCK_RANGE: BlockRange = [0, 0];

/**
 * Abstract class representing a client to interact with an Optimistic Oracle and store the requests.
 */
export abstract class OptimisticOracleClient<R extends OptimisticOracleRequest> {
  protected provider: Provider;
  readonly requests: ReadonlyMap<string, R>;
  readonly fetchedBlockRange: BlockRange;

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
    _fetchedBlockRange: BlockRange = EMPTY_BLOCK_RANGE
  ) {
    this.provider = _provider;
    this.requests = _requests;
    this.fetchedBlockRange = _fetchedBlockRange;
  }

  /**
   * Returns a copy of the OptimisticOracleClient
   * @returns A copy of the OptimisticOracleClient
   * @dev This is a deep copy.
   */
  copy(): OptimisticOracleClient<R> {
    return this.createClientInstance(new Map(this.requests), this.fetchedBlockRange);
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
    fetchedBlockRanges: BlockRange
  ): OptimisticOracleClient<R>;

  /**
   * Returns a copy of the updated Requests by fetching new Oracle requests updates.
   * @param blockRange The new blockRange to fetch requests from.
   * @returns A Promise that resolves to a copy of the updated Requests map.
   */
  protected abstract updateOracleRequests(blockRange: BlockRange): Promise<Map<string, R>>;

  /**
   * Updates the OptimisticOracleClient instance by fetching new Oracle requests within the specified block range. Returns a new instance.
   * @param blockRange (Optional) The block range to fetch new requests from.
   * @returns A Promise that resolves to a new OptimisticOracleClient instance with updated requests.
   */
  async updateWithBlockRange(blockRange?: BlockRange): Promise<OptimisticOracleClient<R>> {
    let range: BlockRange;
    if (blockRange) {
      if (blockRange[0] > blockRange[1])
        throw new Error("Start block number should be less than or equal to end block number");
      range = blockRange;
    } else {
      // Calculate the next block range to fetch
      const latestBlock = await this.provider.getBlockNumber();
      const nextStartBlock = this.fetchedBlockRange[1] + 1;
      if (nextStartBlock > latestBlock) return this; // no new blocks to fetch
      range = [nextStartBlock, latestBlock];
    }
    const [startBlock, endBlock] = range;

    // Throw an error if the new range doesn't directly follow the last fetched range
    const lastFetchedEndBlock = this.fetchedBlockRange[1];
    if (lastFetchedEndBlock != 0 && startBlock !== lastFetchedEndBlock + 1)
      throw new Error(
        "New block range does not follow the last fetched block range, there is a gap between the ranges"
      );

    // We enforce the creation of a new instance of the client to avoid mutating the current instance
    const newRequests = await this.updateOracleRequests([startBlock, endBlock]);

    return this.createClientInstance(newRequests, [startBlock, endBlock]);
  }

  /**
   * Returns the block ranges of the fetched requests.
   * @returns An array of pairs of numbers representing the block ranges.
   */
  getFetchedBlockRange(): BlockRange {
    return this.fetchedBlockRange;
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

/**
 * Abstract class representing a strategy for processing Optimistic Oracle requests.
 * @template I The type of the input OptimisticOracleRequest.
 * @template R The type of the result, based on OptimisticOracleRequestDisputable.
 */
export interface LLMDisputerStrategy<I extends OptimisticOracleRequest, R extends OptimisticOracleRequestDisputable> {
  /**
   * Processes Optimistic Oracle requests using the strategy implementation.
   * @param request The Optimistic Oracle request to be processed.
   * @returns A Promise that resolves to the result of the processing.
   */
  process(request: I): Promise<R>;
}
