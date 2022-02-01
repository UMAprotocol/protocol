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
    const fullRequest = await oo.getRequest(
      request.requester,
      request.identifier,
      request.timestamp,
      request.ancillaryData
    );
    const state = await oo.getState(request.requester, request.identifier, request.timestamp, request.ancillaryData);
    this.write((write) => {
      // create the erc20 service to handle currency
      write.services(chainId).erc20s(fullRequest.currency);
      write
        .chains(chainId)
        .optimisticOracle()
        .request(request, { ...fullRequest, state });
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
}
