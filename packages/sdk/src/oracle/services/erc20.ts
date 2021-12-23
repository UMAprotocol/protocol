import type { BigNumberish, Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { Overrides } from "@ethersproject/contracts";

import { erc20 } from "../../clients";
import Multicall2 from "../../multicall2";
import { BatchReadWithErrors, Calls } from "../../utils";
import { MULTICALL2_ADDRESS } from "../constants";

export type BatchReadWithErrorsType = ReturnType<ReturnType<typeof BatchReadWithErrors>>;
export type EmitResult = (type: string, result: any, ...args: any[]) => void;

export class Erc20 {
  public contract: erc20.Instance;
  private multicall: Multicall2;
  private batchRead: BatchReadWithErrorsType;
  constructor(private address: string, multicallAddress: string, private provider: Provider) {
    this.multicall = new Multicall2(multicallAddress, provider);
    this.contract = erc20.connect(address, provider);
    this.batchRead = BatchReadWithErrors(this.multicall)(this.contract);
  }
  getProps(props: Calls = [["symbol"], ["name"], ["decimals"], ["totalSupply"]]) {
    return this.batchRead(props);
  }
}

// This wraps the client took hook in events. Something like this could be eventually programatic with JS Proxy
export class Erc20Service {
  private erc20: Erc20;
  constructor(
    private address: string,
    private multicallAddress: string = MULTICALL2_ADDRESS,
    private provider: Provider,
    private emit: EmitResult = () => undefined
  ) {
    this.erc20 = new Erc20(address, multicallAddress, provider);
  }
  async getProps() {
    const { erc20, emit } = this;
    const result = await erc20.getProps();
    emit("getProps", result, []);
  }
  async getBalance(account: string) {
    const { erc20, emit } = this;
    const result = await erc20.contract.balanceOf(account);
    emit("getBalance", result.toString(), [account]);
  }
  async getAllowance(account: string, spender: string) {
    const { erc20, emit } = this;
    const result = await erc20.contract.allowance(account, spender);
    emit("getAllowance", result.toString(), [account, spender]);
  }
  async increaseAllowance(signer: Signer, spender: string, amount: BigNumberish, overrides: Overrides = {}) {
    const { erc20, emit } = this;
    const result = await erc20.contract.populateTransaction.increaseAllowance(spender, amount, overrides);
    emit("increaseAllowance", result, [signer, spender, amount, overrides]);
  }
}
