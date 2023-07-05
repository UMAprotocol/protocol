import { Provider } from "@ethersproject/abstract-provider";

export enum OptimisticOracleType {
  PriceRequest = "Assertion",
  Assertion = "Assertion",
}

export class OptimisticOracleRequest {
  claim: string; // Human readable claim.
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

  constructor(data: {
    claim: string;
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
    this.claim = data.claim;
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
export class OptimisticOracleClient {
  protected provider: Provider;
  protected requests: OptimisticOracleRequest[];
  protected fetchedBlockRange: [number, number];

  /**
   * Constructs a new OptimisticOracleClient instance.
   * @param _provider The provider used for interacting with the blockchain.
   * @param _requests (Optional) The list of Optimistic Oracle requests.
   */
  constructor(_provider: Provider, _requests: OptimisticOracleRequest[] = []) {
    this.provider = _provider;
    this.requests = _requests;
    this.fetchedBlockRange = [0, 0];
  }

  /**
   * Retrieves Optimistic Oracle requests within the specified block range.
   * @param blockRange The block range to fetch requests from.
   * @returns A Promise that resolves to an array of OptimisticOracleRequest objects.
   */
  protected async fetchOracleRequests(blockRange: [number, number]): Promise<OptimisticOracleRequest[]> {
    // TODO: Implement this.
    blockRange;
    return [];
  }

  /**
   * Updates the OptimisticOracleClient instance by fetching new Oracle requests within the specified block range. Returns a new instance.
   * @param blockRange The block range to fetch new requests from.
   * @returns A Promise that resolves to a new OptimisticOracleClient instance with updated requests.
   */
  async updateWithBlockRange(blockRange: [number, number]): Promise<OptimisticOracleClient> {
    const newRequests = await this.fetchOracleRequests(blockRange);
    return new OptimisticOracleClient(this.provider, newRequests);
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
  constructor(_provider: Provider, _requests: OptimisticOracleRequest[] = []) {
    super(_provider, _requests);
  }

  protected async fetchOracleRequests(blockRange: [number, number]): Promise<OptimisticOracleRequest[]> {
    // TODO: Implement this for the OptimisticOracleV2
    blockRange;
    return [];
  }
}

export class OptimisticOracleClientV3 extends OptimisticOracleClient {
  constructor(_provider: Provider, _requests: OptimisticOracleRequest[] = []) {
    super(_provider, _requests);
  }

  protected async fetchOracleRequests(blockRange: [number, number]): Promise<OptimisticOracleRequest[]> {
    // TODO: Implement this for the OptimisticOracleV3
    blockRange;
    return [];
  }
}
