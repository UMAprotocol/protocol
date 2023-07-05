import { Provider } from "@ethersproject/abstract-provider";

export type OptimisticOracleRequest = {
  claim: string; // Human readable claim.
  timestamp: number; // Timestamp of the request.
  identifier: string; // Identifier of the request.
  requester: string; // Address of the requester.
  requestTx: string; // Transaction hash of the request.
  proposer?: string; // Address of the proposer.
  proposedValue?: number | boolean; // Proposed value.
  proposeTx?: string; // Transaction hash of the proposal.
  resolvedValue?: number | boolean; // Resolved value.
  resolveTx?: string; // Transaction hash of the resolution.
  disputeTx?: string; // Transaction hash of the dispute.
};

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
