import assert from "assert";

import type { State, Chain, Inputs, Request, Erc20Props, ChainConfig, Flag, Context, Memory } from "../types/state";
import type { Signer, BigNumber } from "../types/ethers";

// This is a typescript compatible way of pulling out values from the global state object, essentially
// forming a basic API. Most calls are parameterless, requiring first setting state which determines, the
// user/chain, etc of the query.

export default class Read {
  constructor(private state: State) {}
  chainConfig(): ChainConfig {
    const chainId = this.requestChainId();
    const config = this.state?.config?.chains?.[chainId];
    assert(config, "No config set for chain: " + chainId);
    return config;
  }
  requestChainId(): number {
    const chainId = this.state?.inputs?.request?.chainId;
    assert(chainId, "ChainId is not set on request");
    return chainId;
  }
  userChainId(): number {
    const chainId = this.state?.inputs?.user?.chainId;
    assert(chainId, "ChainId is not set");
    return chainId;
  }
  requestChain(): Partial<Chain> {
    const chainId = this.requestChainId();
    const chain = this.state?.chains?.[chainId];
    assert(chain, "Chain not set");
    return chain;
  }
  userAddress(): string {
    const address = this.state?.inputs?.user?.address;
    assert(address, "User address is not set");
    return address;
  }
  oracleAddress(): string {
    const chain = this.requestChain();
    const address = chain?.optimisticOracle?.address;
    assert(address, "Optimistic oracle address not set");
    return address;
  }
  signer(): Signer {
    const signer = this.state?.inputs?.user?.signer;
    assert(signer, "Signer is not set");
    return signer;
  }
  inputRequest(): Inputs["request"] {
    const input = this.state?.inputs?.request;
    assert(input, "Input request is not set");
    return input;
  }
  request(): Request {
    const chain = this.requestChain();
    const input = this.inputRequest();
    const id = [input.requester, input.identifier, input.timestamp, input.ancillaryData].join("!");
    const request = chain?.optimisticOracle?.requests?.[id];
    assert(request, "Request has not been fetched");
    return request;
  }
  collateralProps(): Partial<Erc20Props> {
    const request = this.request();
    const chain = this.requestChain();
    const props = chain.erc20s?.[request.currency]?.props;
    assert(props, "Props not set on collateral token");
    return props;
  }
  userCollateralBalance(): BigNumber {
    const request = this.request();
    const chain = this.requestChain();
    const user = this.userAddress();
    const balance = chain?.erc20s?.[request.currency]?.balances?.[user];
    assert(balance, "Balance not set on collateral token for user");
    return balance;
  }
  userCollateralAllowance(): BigNumber {
    const request = this.request();
    const chain = this.requestChain();
    const user = this.userAddress();
    const oracle = this.oracleAddress();
    const allowance = chain?.erc20s?.[request.currency]?.allowances?.[oracle]?.[user];
    assert(allowance, "Allowance not set on user on collateral token for oracle");
    return allowance;
  }
  oracleService() {
    const chainId = this.requestChainId();
    const result = this.state?.services?.chains?.[chainId]?.optimisticOracle;
    assert(result, "Optimistic Oracle Not found on chain " + chainId);
    return result;
  }
  collateralService() {
    const chainId = this.requestChainId();
    const request = this.request();
    const result = this.state?.services?.chains?.[chainId]?.erc20s?.[request.currency];
    assert(result, "Token not supported on chain " + chainId);
    return result;
  }
  flags(): Record<Flag, boolean> | undefined {
    return this.state?.flags;
  }
  command(id: string): Context<unknown, unknown & Memory> | undefined {
    return this.state?.commands?.[id];
  }
}
