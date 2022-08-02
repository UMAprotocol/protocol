import { optimisticOracle } from "../../clients";
import { BigNumberish, Provider, Signer, TransactionResponse, Log, TransactionReceipt } from "../types/ethers";
import type { OracleInterface, RequestKey, OracleProps, Request } from "../types/interfaces";
import { requestId, insertOrderedAscending, eventKey, isUnique, getAddress } from "../utils";

import { RequestPrice, ProposePrice, DisputePrice, Settle } from "../../clients/optimisticOracle";

export type OptimisticOracleEvent = RequestPrice | ProposePrice | DisputePrice | Settle;

export type { RequestPrice, ProposePrice, DisputePrice, Settle };

// this had to be copied in because interfaces in contracts-frontend and contracts-node are different
// The frontend cant use contracts-node because async calls are required for addresses, when testing in node
// we arent able to import contracts-frontend.
export function getOptimisticOracleAddress(chainId: number): string {
  switch (chainId.toString()) {
    case "1":
      return getAddress("0xc43767f4592df265b4a9f1a398b97ff24f38c6a6");
    case "4":
      return getAddress("0x3746badD4d6002666dacd5d7bEE19f60019A8433");
    case "10":
      return getAddress("0x56e2d1b8C7dE8D11B282E1b4C924C32D91f9102B");
    case "42":
      return getAddress("0xB1d3A89333BBC3F5e98A991d6d4C1910802986BC");
    case "100":
      return getAddress("0xd2ecb3afe598b746F8123CaE365a598DA831A449");
    case "137":
      return getAddress("0xBb1A8db2D4350976a11cdfA60A1d43f97710Da49");
    case "288":
      return getAddress("0x7da554228555C8Bf3748403573d48a2138C6b848");
    case "42161":
      return getAddress("0x031A7882cE3e8b4462b057EBb0c3F23Cd731D234");
    case "80001":
      return getAddress("0xAB75727d4e89A7f7F04f57C00234a35950527115");
    default:
      throw new Error(`No address found for deployment OptimisticOracle on chainId ${chainId}`);
  }
}

export class OptimisticOracle implements OracleInterface {
  private readonly contract: optimisticOracle.Instance;
  private readonly events: OptimisticOracleEvent[] = [];
  private requests: Record<string, Request> = {};
  constructor(protected provider: Provider, protected address: string, public readonly chainId: number) {
    this.contract = optimisticOracle.connect(address, provider);
  }
  private upsertRequest = (request: Omit<Request, "chainId">): Request => {
    const id = requestId(request);
    const cachedRequest = this.requests[id] || {};
    const update = { ...cachedRequest, ...request, chainId: this.chainId };
    this.requests[id] = update;
    return update;
  };
  private makeEventFromLog = (log: Log) => {
    const description = this.contract.interface.parseLog(log);
    return {
      ...log,
      ...description,
      event: description.name,
      eventSignature: description.signature,
    };
  };
  private setDisputeHash({ requester, identifier, timestamp, ancillaryData }: RequestKey, hash: string): Request {
    return this.upsertRequest({ requester, identifier, timestamp, ancillaryData, disputeTx: hash });
  }
  private setProposeHash({ requester, identifier, timestamp, ancillaryData }: RequestKey, hash: string): Request {
    return this.upsertRequest({ requester, identifier, timestamp, ancillaryData, proposeTx: hash });
  }
  private setSettleHash({ requester, identifier, timestamp, ancillaryData }: RequestKey, hash: string): Request {
    return this.upsertRequest({ requester, identifier, timestamp, ancillaryData, settleTx: hash });
  }
  private updateFromEvents = (events: OptimisticOracleEvent[]) => {
    events.forEach((event) => {
      if (isUnique(this.events, event, eventKey)) {
        insertOrderedAscending(this.events, event, eventKey);
      }
    });
    const { requests = {} } = optimisticOracle.getEventState(this.events);
    Object.values(requests).map((request) => this.upsertRequest(request));
  };
  async fetchRequest({ requester, identifier, timestamp, ancillaryData }: RequestKey): Promise<Request> {
    const request = await this.contract.callStatic.getRequest(requester, identifier, timestamp, ancillaryData);
    const state = await this.contract.callStatic.getState(requester, identifier, timestamp, ancillaryData);
    return this.upsertRequest({ ...request, state, requester, identifier, timestamp, ancillaryData });
  }

  getRequest(key: RequestKey): Request {
    const id = requestId(key);
    const request = this.requests[id] || key;
    return { ...request };
  }
  async disputePrice(
    signer: Signer,
    { requester, identifier, timestamp, ancillaryData }: RequestKey
  ): Promise<TransactionResponse> {
    const contract = optimisticOracle.connect(this.address, signer);
    const tx = await contract.disputePrice(requester, identifier, timestamp, ancillaryData);
    this.setDisputeHash({ requester, identifier, timestamp, ancillaryData }, tx.hash);
    return tx;
  }
  async proposePrice(
    signer: Signer,
    { requester, identifier, timestamp, ancillaryData }: RequestKey,
    price: BigNumberish
  ): Promise<TransactionResponse> {
    const contract = optimisticOracle.connect(this.address, signer);
    const tx = await contract.proposePrice(requester, identifier, timestamp, ancillaryData, price);
    this.setProposeHash({ requester, identifier, timestamp, ancillaryData }, tx.hash);
    return tx;
  }
  async settle(
    signer: Signer,
    { requester, identifier, timestamp, ancillaryData }: RequestKey
  ): Promise<TransactionResponse> {
    const contract = optimisticOracle.connect(this.address, signer);
    const tx = await contract.settle(requester, identifier, timestamp, ancillaryData);
    this.setSettleHash({ requester, identifier, timestamp, ancillaryData }, tx.hash);
    return tx;
  }
  async update(startBlock = 0, endBlock: number | "latest" = "latest"): Promise<void> {
    const events = await this.contract.queryFilter({}, startBlock, endBlock);
    this.updateFromEvents((events as unknown[]) as OptimisticOracleEvent[]);
  }
  async getProps(): Promise<OracleProps> {
    return {
      defaultLiveness: await this.contract.defaultLiveness(),
    };
  }
  updateFromTransactionReceipt(receipt: TransactionReceipt): void {
    const events = receipt.logs.map((log) => this.makeEventFromLog(log));
    this.updateFromEvents((events as unknown[]) as OptimisticOracleEvent[]);
  }
  listRequests(): Request[] {
    return Object.values(this.requests);
  }
}
