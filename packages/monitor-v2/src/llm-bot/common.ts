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

export class OptimisticOracleClient {
  protected provider: Provider;
  protected requests: OptimisticOracleRequest[];

  constructor(_provider: Provider, _requests: OptimisticOracleRequest[] = []) {
    this.provider = _provider;
    this.requests = _requests;
  }

  protected async getOracleRequests(blockRange: [number, number]): Promise<OptimisticOracleRequest[]> {
    // TODO: Implement this.
    blockRange;
    return [];
  }

  async update(blockRange: [number, number]): Promise<OptimisticOracleClient> {
    const newRequests = await this.getOracleRequests(blockRange);
    return new OptimisticOracleClient(this.provider, newRequests);
  }

  getRequests(): OptimisticOracleRequest[] {
    return this.requests;
  }
}

export class OptimisticOracleClientV2 extends OptimisticOracleClient {
  constructor(_provider: Provider, _requests: OptimisticOracleRequest[] = []) {
    super(_provider, _requests);
  }

  protected async getOracleRequests(blockRange: [number, number]): Promise<OptimisticOracleRequest[]> {
    // TODO: Implement this for the OptimisticOracleV2
    blockRange;
    return [];
  }
}

export class OptimisticOracleClientV3 extends OptimisticOracleClient {
  constructor(_provider: Provider, _requests: OptimisticOracleRequest[] = []) {
    super(_provider, _requests);
  }

  protected async getOracleRequests(blockRange: [number, number]): Promise<OptimisticOracleRequest[]> {
    // TODO: Implement this for the OptimisticOracleV3
    blockRange;
    return [];
  }
}
