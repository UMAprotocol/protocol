import { optimisticOracle } from "../../../clients";
import { BigNumberish, BigNumber, Provider, Signer, TransactionResponse, Log } from "../types/ethers";
/**
 * RequestState.
 */
type RequestState = optimisticOracle.RequestState;

type Props = {
  defaultLiveness: BigNumber;
};
type Request = ReturnType<optimisticOracle.Instance["getRequest"]>;

export class OptimisticOracle {
  public readonly contract: optimisticOracle.Instance;
  constructor(protected provider: Provider, protected address: string) {
    this.contract = optimisticOracle.connect(address, provider);
  }
  async getRequest(
    requester: string,
    identifier: string,
    timestamp: BigNumberish,
    ancillaryData: string
  ): Promise<Request> {
    return this.contract.callStatic.getRequest(requester, identifier, timestamp, ancillaryData);
  }
  async disputePrice(
    signer: Signer,
    ...args: Parameters<optimisticOracle.Instance["disputePrice"]>
  ): Promise<TransactionResponse> {
    const contract = optimisticOracle.connect(this.address, signer);
    return contract.disputePrice(...args);
  }
  async proposePrice(
    signer: Signer,
    ...args: Parameters<optimisticOracle.Instance["proposePrice"]>
  ): Promise<TransactionResponse> {
    const contract = optimisticOracle.connect(this.address, signer);
    return contract.proposePrice(...args);
  }
  async settle(signer: Signer, ...args: Parameters<optimisticOracle.Instance["settle"]>): Promise<TransactionResponse> {
    const contract = optimisticOracle.connect(this.address, signer);
    return contract.settle(...args);
  }
  async getProps(): Promise<Props> {
    return {
      defaultLiveness: await this.contract.defaultLiveness(),
    };
  }
  async getCurrentTime(): Promise<BigNumber> {
    return this.contract.getCurrentTime();
  }
  async getState(
    requester: string,
    identifier: string,
    timestamp: BigNumberish,
    ancillaryData: string
  ): Promise<RequestState> {
    return this.contract.callStatic.getState(requester, identifier, timestamp, ancillaryData);
  }
  makeEventFromLog = (log: Log) => {
    const description = this.contract.interface.parseLog(log);
    return {
      ...log,
      ...description,
      event: description.name,
      eventSignature: description.signature,
    };
  };
}
