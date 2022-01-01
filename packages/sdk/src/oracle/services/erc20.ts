import { erc20 } from "../../clients";
import Multicall2 from "../../multicall2";
import { BatchReadWithErrors, BatchReadWithErrorsType, Calls } from "../../utils";
import { BigNumber, Provider } from "../types/ethers";

const batchProps: Calls = [["symbol"], ["name"], ["decimals"], ["totalSupply"]];
type Props = {
  symbol: string;
  name: string;
  decimals: number;
  totalSupply: BigNumber;
};
export class Erc20 {
  public contract: erc20.Instance;
  constructor(protected provider: Provider, protected address: string) {
    this.contract = erc20.connect(address, provider);
  }
  async getProps(): Promise<Props> {
    const { contract } = this;
    return {
      symbol: await contract.callStatic.symbol(),
      name: await contract.callStatic.name(),
      decimals: await contract.callStatic.decimals(),
      totalSupply: await contract.callStatic.totalSupply(),
    };
  }
}
export class Erc20Multicall extends Erc20 {
  private multicall: Multicall2;
  private batchRead: BatchReadWithErrorsType;
  constructor(provider: Provider, address: string, private multicallAddress: string) {
    super(provider, address);
    this.multicall = new Multicall2(multicallAddress, this.provider);
    this.batchRead = BatchReadWithErrors(this.multicall)(this.contract);
  }
  async getProps(): Promise<Props> {
    return this.batchRead<Props>(batchProps);
  }
}
export function factory(provider: Provider, address: string, multicallAddress?: string): Erc20 {
  if (!multicallAddress) return new Erc20(provider, address);
  return new Erc20Multicall(provider, address, multicallAddress);
}
