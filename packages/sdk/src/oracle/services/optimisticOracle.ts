import { OptimisticOracleEthers, OptimisticOracleEthers__factory } from "@uma/contracts-node";
import { BigNumberish, BigNumber, Provider } from "../types/ethers";

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
  async getProps(): Promise<Props> {
    return {
      defaultLiveness: await this.contract.defaultLiveness(),
    };
  }
}
