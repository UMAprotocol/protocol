import Store from "../store";
import { InputRequest } from "../types/state";
import { TransactionReceipt } from "../types/ethers";

export class Update {
  private read: Store["read"];
  private write: Store["write"];
  constructor(private store: Store) {
    this.read = store.read;
    this.write = store.write;
  }
  all = async (): Promise<void> => {
    await this.oracle();
    await this.request();
    await this.collateralProps();
    await this.userCollateralBalance();
    await this.oracleAllowance();
  };
  request = async (params?: InputRequest): Promise<void> => {
    const request = params || this.read().inputRequest();
    const chainId = request.chainId;
    const oo = this.read().oracleService(chainId);
    // // pull in data from contract on chain
    const contractRequest = await oo.fetchRequest(request);
    this.write((write) => {
      // create the erc20 service to handle currency
      if (contractRequest.currency) {
        write.services(chainId).erc20s(contractRequest.currency);
      }
      write
        .chains(chainId)
        .optimisticOracle()
        // update request object with all the data we have about it. order is important,
        // we want to prioritize latest state pulled from contract.
        .request({ ...contractRequest });
    });
    this.sortedRequests(chainId);
  };
  oracle = async (): Promise<void> => {
    const chainId = this.read().requestChainId();
    const oo = this.read().oracleService();
    const { defaultLiveness } = await oo.getProps();
    this.write((write) => write.chains(chainId).optimisticOracle().defaultLiveness(defaultLiveness));
  };
  userCollateralBalance = async (): Promise<void> => {
    const chainId = this.read().requestChainId();
    const account = this.read().userAddress();
    const token = this.read().collateralService();
    const result = await token.contract.balanceOf(account);
    this.write((write) => write.chains(chainId).erc20s(token.address).balance(account, result));
  };
  collateralProps = async (): Promise<void> => {
    const chainId = this.read().requestChainId();
    const token = this.read().collateralService();
    const props = await token.getProps();
    this.write((write) => write.chains(chainId).erc20s(token.address).props(props));
  };
  oracleAllowance = async (): Promise<void> => {
    const chainId = this.read().requestChainId();
    const account = this.read().userAddress();
    const oracleAddress = this.read().oracleAddress();
    const token = this.read().collateralService();
    const result = await token.contract.allowance(account, oracleAddress);
    this.write((write) => write.chains(chainId).erc20s(token.address).allowance(account, oracleAddress, result));
  };
  balance = async (chainId: number, token: string, account: string): Promise<void> => {
    const tokenService = this.read().tokenService(chainId, token);
    const result = await tokenService.contract.balanceOf(account);
    this.write((write) => write.chains(chainId).erc20s(token).balance(account, result));
  };
  allowance = async (chainId: number, token: string, account: string, spender: string): Promise<void> => {
    const tokenService = this.read().tokenService(chainId, token);
    const result = await tokenService.contract.allowance(account, spender);
    this.write((write) => write.chains(chainId).erc20s(token).allowance(account, spender, result));
  };
  isConfirmed = async (chainId: number, hash: string, confirmations: number): Promise<boolean | TransactionReceipt> => {
    const txService = this.read().transactionService(chainId);
    return txService.isConfirmed(hash, confirmations);
  };
  // update new events from this range query, will accumulate new events
  oracleEvents = async (chainId: number, startBlock = 0, endBlock?: number): Promise<void> => {
    const provider = this.read().provider(chainId);
    const oracle = this.read().oracleService(chainId);
    endBlock = endBlock || (await provider.getBlockNumber());
    await oracle.update(startBlock, endBlock);
  };
  // takes all known events, decodes them into requests and puts them into a sorted table. then updates the sorted list.
  sortedRequests = (chainId: number): void => {
    const sortedRequestsService = this.read().sortedRequestsService();
    const oracle = this.read().oracleService(chainId);
    const requests = oracle.listRequests();
    const oracleType = this.read().oracleType();
    Object.values(requests).forEach((value) => {
      // chains can have colliding keys ( mainly testnet forks), so we always need to append chain to to keep key unique across chains otherwise
      // collisions will cause overwrites, removing ability to list identical requests across chains.
      sortedRequestsService.setByRequest({ ...value, oracleType });
    });
    // query all known requests and update our state with the entire list.
    // this is expensive, consider optimizing after proven detrimental.
    const descendingRequests = sortedRequestsService.descending();
    this.write((w) => {
      w.descendingRequests(descendingRequests);
    });
  };
  // this updates the current active request object used in the details page, as new properties might come in from events
  // current request needs access to things like transation hash, only available through events.
  activeRequestFromEvents = (params?: InputRequest): void => {
    const request = params || this.read().inputRequest();
    const chainId = request.chainId;
    // pull in request data generated from events
    const requestIndexData = this.read().oracleService().getRequest(request);
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
  };
}
