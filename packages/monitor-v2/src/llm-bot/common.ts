import { Provider } from "@ethersproject/abstract-provider";

export enum OptimisticOracleType {
  PriceRequest = "PriceRequest",
  Assertion = "Assertion",
}

export class OptimisticOracleRequest {
  readonly body: string; // Human readable request body.
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

  constructor(data: {
    body: string;
    type: OptimisticOracleType;
    timestamp: number;
    identifier: string;
    requester: string;
    requestTx: string;
    proposer?: string;
    proposedValue?: number | boolean;
    proposeTx?: string;
    disputableUntil?: number;
    resolvedValue?: number | boolean;
    resolveTx?: string;
    disputeTx?: string;
  }) {
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
 * Represents a client to interact with an Optimistic Oracle and store the requests.
 */
export abstract class OptimisticOracleClient {
  protected provider: Provider;
  protected requests: OptimisticOracleRequest[];
  protected fetchedBlockRange: [number, number];

  /**
   * Constructs a new OptimisticOracleClient instance.
   * @param _provider The provider used for interacting with the blockchain.
   * @param _requests (Optional) The list of Optimistic Oracle requests.
   * @param _fetchedBlockRange (Optional) The block range of the fetched requests.
   */
  protected constructor(
    _provider: Provider,
    _requests?: OptimisticOracleRequest[],
    _fetchedBlockRange?: [number, number]
  ) {
    this.provider = _provider;
    this.requests = _requests || [];
    this.fetchedBlockRange = _fetchedBlockRange || [0, 0];
  }

  /**
   * Creates a new instance of the OptimisticOracleClient with the specified requests.
   * Must be implemented by the derived class.
   * @param provider The provider used for interacting with the blockchain.
   * @param requests The requests to be set on the new instance.
   * @param fetchedBlockRange The block range of the fetched requests.
   * @returns A new instance of OptimisticOracleClient.
   */
  protected abstract createClientInstance(
    requests: OptimisticOracleRequest[],
    fetchedBlockRange: [number, number]
  ): OptimisticOracleClient;

  /**
   * Retrieves Optimistic Oracle requests within the specified block range.
   * @param blockRange The block range to fetch requests from.
   * @returns A Promise that resolves to an array of OptimisticOracleRequest objects.
   */
  protected abstract fetchOracleRequests(blockRange: [number, number]): Promise<OptimisticOracleRequest[]>;

  /**
   * Updates the OptimisticOracleClient instance by fetching new Oracle requests within the specified block range. Returns a new instance.
   * @param blockRange The block range to fetch new requests from.
   * @param existingRequests (Optional) The list of existing requests to merge with the new requests.
   * @returns A Promise that resolves to a new OptimisticOracleClient instance with updated requests.
   */
  async updateWithBlockRange(
    existingRequests: OptimisticOracleRequest[] = [],
    blockRange: [number, number]
  ): Promise<OptimisticOracleClient> {
    const newRequests = await this.fetchOracleRequests(blockRange);
    return this.createClientInstance([...existingRequests, ...newRequests], blockRange);
  }

  /**
   * Returns the list of Optimistic Oracle requests.
   * @returns An array of OptimisticOracleRequest objects.
   */
  getRequests(): OptimisticOracleRequest[] {
    return this.requests || [];
  }

  /**
   * Returns the block range of the fetched requests.
   * @returns An array of two numbers representing the block range.
   */
  getFetchedBlockRange(): [number, number] {
    return this.fetchedBlockRange;
  }
}

export class OptimisticOracleClientV2 extends OptimisticOracleClient {
  constructor(_provider: Provider, _requests: OptimisticOracleRequest[] = [], _fetchedBlockRange?: [number, number]) {
    super(_provider, _requests, _fetchedBlockRange);
  }

  protected async fetchOracleRequests(blockRange: [number, number]): Promise<OptimisticOracleRequest[]> {
    // TODO: Implement this for the OptimisticOracleV2
    blockRange;
    return [];
  }

  protected createClientInstance(
    requests: OptimisticOracleRequest[],
    fetchedBlockRange: [number, number]
  ): OptimisticOracleClient {
    return new OptimisticOracleClientV2(this.provider, requests, fetchedBlockRange);
  }
}

export class OptimisticOracleClientV3 extends OptimisticOracleClient {
  constructor(_provider: Provider, _requests: OptimisticOracleRequest[] = [], _fetchedBlockRange?: [number, number]) {
    super(_provider, _requests, _fetchedBlockRange);
  }

  protected async fetchOracleRequests(blockRange: [number, number]): Promise<OptimisticOracleRequest[]> {
    // TODO: Implement this for the OptimisticOracleV3
    blockRange;
    return [];
  }

  protected createClientInstance(
    requests: OptimisticOracleRequest[],
    fetchedBlockRange: [number, number]
  ): OptimisticOracleClient {
    return new OptimisticOracleClientV2(this.provider, requests, fetchedBlockRange);
  }
}
