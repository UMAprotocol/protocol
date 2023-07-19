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
  protected fetchedBlockRange: [number, number];

  /**
   * Constructs a new instance of OptimisticOracleClient.
   * @param _provider The provider used for interacting with the blockchain.
   * @param _requests (Optional) The list of Optimistic Oracle requests.
   * @param _fetchedBlockRange (Optional) The block range of the fetched requests.
   */
  protected constructor(_provider: Provider, _requests?: R[], _fetchedBlockRange?: [number, number]) {
    this.provider = _provider;
    this.requests = _requests || [];
    this.fetchedBlockRange = _fetchedBlockRange || [0, 0];
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
    fetchedBlockRange: [number, number]
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
   * @param existingRequests (Optional) The list of existing requests to merge with the new requests.
   * @returns A Promise that resolves to a new OptimisticOracleClient instance with updated requests.
   */
  async updateWithBlockRange(blockRange?: [number, number], existingRequests: R[] = []): Promise<this> {
    let range: [number, number];
    if (blockRange) {
      if (blockRange[0] > blockRange[1]) throw new Error("Invalid block range");
      range = blockRange;
    } else {
      const latestBlock = await this.provider.getBlockNumber();
      const nextStartBlock = this.fetchedBlockRange[1] + 1;
      range = [nextStartBlock, latestBlock >= nextStartBlock ? latestBlock : nextStartBlock];
    }
    const newRequests = await this.fetchOracleRequests(range);
    // TODO handle duplicates
    return this.createClientInstance([...existingRequests, ...newRequests], range) as this;
  }

  /**
   * Returns the list of Optimistic Oracle requests.
   * @returns An array of OptimisticOracleRequest objects.
   */
  getRequests(): R[] {
    return this.requests || [];
  }

  /**
   * Returns the block range of the fetched requests.
   * @returns An array of two numbers representing the block range.
   */
  getFetchedBlockRange(): [number, number] {
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
 * Implementations should take an array of input OptimisticOracleRequests and generate results based on the defined strategy.
 * @template I The type of the input OptimisticOracleRequest.
 * @template R The type of the result, which could be a different kind of OptimisticOracleRequest or some other type.
 */
export abstract class LLMStrategy<I extends OptimisticOracleRequest, R extends OptimisticOracleRequest> {
  protected optimisticOracleRequests: I[];
  protected results: R[] = [];

  /**
   * Creates a new LLMStrategy.
   * @param optimisticOracleRequests The Optimistic Oracle requests to be processed.
   */
  constructor(optimisticOracleRequests: I[]) {
    this.optimisticOracleRequests = optimisticOracleRequests;
  }

  /**
   * Processes Optimistic Oracle requests using the strategy implementation.
   * This method should be overridden by implementations of LLMStrategy.
   * @returns A Promise that resolves once the processing is complete.
   */
  abstract process(): Promise<void>;

  /**
   * Returns the results of the processing.
   * @returns An array of Optimistic Oracle requests representing the results.
   */
  getResults(): R[] {
    return this.results;
  }
}

/**
 * Enum for options available for handling strategy results.
 */
export enum StrategyHandlerOptions {
  Dispute = "Dispute",
  Propose = "Propose",
  Log = "Log",
  Backtest = "Backtest",
}

/**
 * Class for handling the results of an LLMStrategy.
 * This can be used to execute further actions based on the strategy results, such as disputing or proposing new requests, logging, or backtesting.
 * @template R The type of the results from the LLMStrategy.
 */
export abstract class OptimisticOracleStrategyHandler<R extends OptimisticOracleRequest> {
  protected strategyResults: R[];

  /**
   * Creates a new OptimisticOracleStrategyHandler.
   * @param strategyResults The results from an LLMStrategy to be handled.
   */
  constructor(strategyResults: R[]) {
    this.strategyResults = strategyResults;
  }

  /**
   * Processes the results of the strategy based on the provided option.
   * This is an abstract method that should be overridden by subclasses, defining the specific processing logic.
   * @param option One of the options in the StrategyHandlerOptions enum, which defines the action to take on the results.
   * @returns A Promise that resolves once the processing is complete.
   */
  abstract process(option: StrategyHandlerOptions): Promise<void>;

  /**
   * Initiates a dispute for a specific strategy result.
   * This method should be overridden by implementations that need to dispute requests.
   * @param result The specific result to dispute.
   * @returns A Promise that resolves once the dispute has been initiated.
   */
  protected async disputeRequest(result: R): Promise<void> {
    result;
    // Implement dispute logic here.
  }

  /**
   * Proposes a new request for a specific strategy result.
   * This method should be overridden by implementations that need to propose requests.
   * @param result The specific result to propose a new request for.
   * @returns A Promise that resolves once the proposal has been made.
   */
  protected async proposeRequest(result: R): Promise<void> {
    result;
    // Implement propose logic here.
  }

  /**
   * Logs a specific strategy result.
   * This method should be overridden by implementations that need to log requests.
   * @param result The specific result to log.
   * @returns A Promise that resolves once the log has been created.
   */
  protected async logRequest(result: R): Promise<void> {
    result;
    // Implement log logic here.
  }

  /**
   * Performs backtesting on a specific strategy result.
   * This method should be overridden by implementations that need to backtest requests.
   * @param result The specific result to backtest.
   * @returns A Promise that resolves once backtesting is complete.
   */
  protected async backtestRequest(result: R): Promise<void> {
    result;
    // Implement backtest logic here.
  }
}
