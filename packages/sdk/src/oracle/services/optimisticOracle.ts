import { OptimisticOracleEthers, OptimisticOracleEthers__factory } from "@uma/contracts-node";
import { BigNumberish, BigNumber, Provider, Signer, TransactionResponse } from "../types/ethers";
import type { RequestState } from "../types/state";

type Props = {
  defaultLiveness: BigNumber;
};
type Request = ReturnType<OptimisticOracleEthers["getRequest"]>;

export class OptimisticOracle {
  public readonly contract: OptimisticOracleEthers;
  constructor(protected provider: Provider, protected address: string) {
    this.contract = OptimisticOracleEthers__factory.connect(address, provider);
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
    ...args: Parameters<OptimisticOracleEthers["disputePrice"]>
  ): Promise<TransactionResponse> {
    const contract = OptimisticOracleEthers__factory.connect(this.address, signer);
    return contract.disputePrice(...args);
  }
  async proposePrice(
    signer: Signer,
    ...args: Parameters<OptimisticOracleEthers["proposePrice"]>
  ): Promise<TransactionResponse> {
    const contract = OptimisticOracleEthers__factory.connect(this.address, signer);
    return contract.proposePrice(...args);
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
}
