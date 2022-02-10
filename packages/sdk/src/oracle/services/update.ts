import Store from "../store";
import { InputRequest, OptimisticOracleEvent } from "../types/state";
import { TransactionReceipt } from "../types/ethers";
import { optimisticOracle } from "../../clients";

export class Update {
  private read: Store["read"];
  private write: Store["write"];
  constructor(private store: Store) {
    this.read = store.read;
    this.write = store.write;
  }
  async all(): Promise<void> {
    await this.oracle();
    await this.request();
    await this.collateralProps();
    await this.userCollateralBalance();
    await this.oracleAllowance();
  }
  async request(params?: InputRequest): Promise<void> {
    const request = params || this.read().inputRequest();
    const chainId = request.chainId;
    const oo = this.read().oracleService(chainId);
    // pull in data from contract on chain
    const contractRequest = await oo.getRequest(
      request.requester,
      request.identifier,
      request.timestamp,
      request.ancillaryData
    );
    // pull in latest request state
    const state = await oo.getState(request.requester, request.identifier, request.timestamp, request.ancillaryData);
    // pull in request data generated from events
    const requestIndexData = this.read().sortedRequestsService().getByRequest(request);
    this.write((write) => {
      // create the erc20 service to handle currency
      write.services(chainId).erc20s(contractRequest.currency);
      write
        .chains(chainId)
        .optimisticOracle()
        // update request object with all the data we have about it. order is important,
        // we want to prioritize latest state pulled from contract.
        .request({ ...requestIndexData, ...request, ...contractRequest, state });
    });
  }
  async oracle(): Promise<void> {
    const chainId = this.read().requestChainId();
    const oo = this.read().oracleService();
    const { defaultLiveness } = await oo.getProps();
    this.write((write) => write.chains(chainId).optimisticOracle().defaultLiveness(defaultLiveness));
  }
  async userCollateralBalance(): Promise<void> {
    const chainId = this.read().requestChainId();
    const account = this.read().userAddress();
    const token = this.read().collateralService();
    const result = await token.contract.balanceOf(account);
    this.write((write) => write.chains(chainId).erc20s(token.address).balance(account, result));
  }
  async collateralProps(): Promise<void> {
    const chainId = this.read().requestChainId();
    const token = this.read().collateralService();
    const props = await token.getProps();
    this.write((write) => write.chains(chainId).erc20s(token.address).props(props));
  }
  async oracleAllowance(): Promise<void> {
    const chainId = this.read().requestChainId();
    const account = this.read().userAddress();
    const oracleAddress = this.read().oracleAddress();
    const token = this.read().collateralService();
    const result = await token.contract.allowance(account, oracleAddress);
    this.write((write) => write.chains(chainId).erc20s(token.address).allowance(account, oracleAddress, result));
  }
  async balance(chainId: number, token: string, account: string): Promise<void> {
    const tokenService = this.read().tokenService(chainId, token);
    const result = await tokenService.contract.balanceOf(account);
    this.write((write) => write.chains(chainId).erc20s(token).balance(account, result));
  }
  async allowance(chainId: number, token: string, account: string, spender: string): Promise<void> {
    const tokenService = this.read().tokenService(chainId, token);
    const result = await tokenService.contract.allowance(account, spender);
    this.write((write) => write.chains(chainId).erc20s(token).allowance(account, spender, result));
  }
  async isConfirmed(chainId: number, hash: string, confirmations: number): Promise<boolean | TransactionReceipt> {
    const txService = this.read().transactionService(chainId);
    return txService.isConfirmed(hash, confirmations);
  }
  // this could use provider blocktime, but the oracle has a handle to get time also
  async currentTime(optionalChainId?: number): Promise<void> {
    const chainId = optionalChainId || this.read().requestChainId();
    const oo = this.read().oracleService(chainId);
    const currentTime = await oo.getCurrentTime();
    this.write((write) => write.chains(chainId).currentTime(currentTime));
  }
  // update new events from this range query, will accumulate new events
  async oracleEvents(chainId: number, startBlock = 0, endBlock?: number): Promise<void> {
    const provider = this.read().provider(chainId);
    const oracle = this.read().oracleService(chainId);
    endBlock = endBlock || (await provider.getBlockNumber());
    const events = await oracle.contract.queryFilter({}, startBlock, endBlock);
    this.write((w) => {
      events.forEach((event) => {
        w.chains(chainId)
          .optimisticOracle()
          .event(event as OptimisticOracleEvent);
      });
    });
  }
  // takes all known events, decodes them into requests and puts them into a sorted table. then updates the sorted list.
  sortedRequests(chainId: number): void {
    // get all known events
    const events = this.read().oracleEvents(chainId);
    // this is expensive, it has to run through all events every update. consider optimizing after proven detrimental.
    const { requests = {} } = optimisticOracle.getEventState(events);
    const sortedRequestsService = this.read().sortedRequestsService();
    Object.values(requests).forEach((value) => {
      // chains can have colliding keys ( mainly testnet forks), so we always need to append chain to to keep key unique across chains otherwise
      // collisions will cause overwrites, removing ability to list identical requests across chains.
      sortedRequestsService.setByRequest({ ...value, chainId });
    });
    // query all known requests and update our state with the entire list.
    // this is expensive, consider optimizing after proven detrimental.
    const descendingRequests = sortedRequestsService.descending();
    this.write((w) => {
      w.descendingRequests(descendingRequests);
    });
  }
  // this updates the current active request object used in the details page, as new properties might come in from events
  // current request needs access to things like transation hash, only available through events.
  activeRequestFromEvents(params?: InputRequest): void {
    const request = params || this.read().inputRequest();
    const chainId = request.chainId;
    // pull in request data generated from events
    const requestIndexData = this.read().sortedRequestsService().getByRequest(request);
    // we really only care about a handful of props from event based requests. We also dont want to override
    // any properties that might overlap with the data queried from the contract.
    const {
      requestTx,
      proposeTx,
      disputeTx,
      settleTx,
      requestBlockNumber,
      proposeBlockNumber,
      disputeBlockNumber,
      settleBlockNumber,
    } = requestIndexData;

    const update = {
      ...request,
      requestTx,
      proposeTx,
      disputeTx,
      settleTx,
      requestBlockNumber,
      proposeBlockNumber,
      disputeBlockNumber,
      settleBlockNumber,
    };

    this.write((write) => {
      write.chains(chainId).optimisticOracle().request(update);
    });
  }
}
