// This is almost a direct copy of the OO v1 service, just with updated abis and different contract addresses
import { optimisticOracle } from "../../clients";
import { BigNumberish, Provider, Signer, TransactionResponse, Log, TransactionReceipt } from "../types/ethers";
import type { OracleInterface, RequestKey, OracleProps, Request } from "../types/interfaces";
import { requestId, insertOrderedAscending, eventKey, isUnique, getAddress } from "../utils";

import { RequestPrice, ProposePrice, DisputePrice, Settle } from "../../clients/optimisticOracleV2";

export type OptimisticOracleEvent = RequestPrice | ProposePrice | DisputePrice | Settle;

export type { RequestPrice, ProposePrice, DisputePrice, Settle };

// this had to be copied in because interfaces in contracts-frontend and contracts-node are different
// The frontend cant use contracts-node because async calls are required for addresses, when testing in node
// we arent able to import contracts-frontend.
export function getOptimisticOracleAddress(chainId: number): string {
  switch (chainId.toString()) {
    case "1":
      return getAddress("0xA0Ae6609447e57a42c51B50EAe921D701823FFAe");
    case "5":
      return getAddress("0x3C8a21099C202003Ec6f050Eb24F8f24a3828Ad3");
    case "10":
      return getAddress("0x255483434aba5a75dc60c1391bB162BCd9DE2882");
    case "137":
      return getAddress("0xee3afe347d5c74317041e2618c49534daf887c24");
    case "288":
      return getAddress("0xb2b5C1b17B19d92CC4fC1f026B2133259e3ccd41");
    case "416":
      return getAddress("0x28077B47Cd03326De7838926A63699849DD4fa87");
    case "42161":
      return getAddress("0x88Ad27C41AD06f01153E7Cd9b10cBEdF4616f4d5");
    case "43114":
      return getAddress("0x28077B47Cd03326De7838926A63699849DD4fa87");
    case "9001":
      return getAddress("0xd2ecb3afe598b746F8123CaE365a598DA831A449");
    default:
      throw new Error(`No address found for deployment OptimisticOracle on chainId ${chainId}`);
  }
}

export class OptimisticOracleV2 implements OracleInterface {
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
