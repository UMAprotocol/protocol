import Store from "../store";
import { getFlags } from "../utils";

export class Update {
  private read: Store["read"];
  private write: Store["write"];
  constructor(private store: Store) {
    this.read = store.read;
    this.write = store.write;
  }
  async all() {
    await this.oracle();
    await this.request();
    await this.collateralProps();
    await this.userCollateralBalance();
    await this.oracleAllowance();
  }
  async request() {
    const request = this.read().inputRequest();
    const chainId = request.chainId;
    const oo = this.read().oracleService();
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
  async oracle() {
    const chainId = this.read().requestChainId();
    const oo = this.read().oracleService();
    const { defaultLiveness } = await oo.getProps();
    this.write((write) => write.chains(chainId).optimisticOracle().defaultLiveness(defaultLiveness));
  }
  async userCollateralBalance() {
    const chainId = this.read().requestChainId();
    const account = this.read().userAddress();
    const token = this.read().collateralService();
    const result = await token.contract.balanceOf(account);
    this.write((write) => write.chains(chainId).erc20s(token.address).balance(account, result));
  }
  async collateralProps() {
    const chainId = this.read().requestChainId();
    const token = this.read().collateralService();
    const props = await token.getProps();
    this.write((write) => write.chains(chainId).erc20s(token.address).props(props));
  }
  async oracleAllowance() {
    const chainId = this.read().requestChainId();
    const account = this.read().userAddress();
    const oracleAddress = this.read().oracleAddress();
    const token = this.read().collateralService();
    const result = await token.contract.allowance(account, oracleAddress);
    this.write((write) => write.chains(chainId).erc20s(token.address).allowance(account, oracleAddress, result));
  }
  flags() {
    this.write((w, s) => w.flags(getFlags(s)));
  }
}
