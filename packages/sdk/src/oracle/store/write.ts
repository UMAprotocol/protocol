import type * as ethers from "../types/ethers";
import type * as state from "../types/state";

// This file contains composable and type safe state writers which mirror the state in types/state.
// Each component takes in 1 parameters, state and you can include any number of functions to operate on the state.
// Some things to consider:
// 1. State can be nested, but it should strictly one direction, each class should ideally only operate on its direct state object.
// 2. The parent can return new components, but its responsible for initializing the state for the child.
// 3. You can modify this.state in the component thanks to immer, but you cannot set this.state to a new object, only its properties.

export class User {
  constructor(private state: Partial<state.User>) {}
  set(data: Partial<state.User>): void {
    // note that this is done because we cannot replace this.state = data or immer loses visibility to the change.
    if (data.chainId) this.chainId(data.chainId);
    if (data.address) this.address(data.address);
    if (data.signer) this.signer(data.signer);
  }
  chainId(chainId: number): void {
    this.state.chainId = chainId;
  }
  address(address: string): void {
    this.state.address = address;
  }
  signer(signer: ethers.Signer): void {
    this.state.signer = signer;
  }
}
export class Balances {
  constructor(private state: Partial<state.Balances>) {}
  set(address: string, amount: ethers.BigNumber): void {
    this.state[address] = amount;
  }
}
export class Erc20 {
  constructor(private state: Partial<state.Erc20>) {}
  props(data: state.Erc20["props"]): void {
    this.state.props = data;
  }
  balance(account: string, amount: ethers.BigNumber): void {
    if (!this.state.balances) this.state.balances = {};
    new Balances(this.state.balances).set(account, amount);
  }
  allowance(account: string, spender: string, amount: ethers.BigNumber): void {
    if (!this.state.allowances) this.state.allowances = {};
    if (!this.state.allowances[spender]) this.state.allowances[spender] = {};
    new Balances(this.state.allowances[spender]).set(account, amount);
  }
}
export class OptimisticOracle {
  constructor(private state: Partial<state.OptimisticOracle>) {}
  address(address: string): void {
    this.state.address = address;
  }
  request(inputRequest: state.Inputs["request"], request: state.Request): void {
    const id = [
      inputRequest.requester,
      inputRequest.identifier,
      inputRequest.timestamp,
      inputRequest.ancillaryData,
    ].join("!");
    if (!this.state.requests) this.state.requests = {};
    this.state.requests[id] = request;
  }
  defaultLiveness(defaultLiveness: ethers.BigNumber): void {
    this.state.defaultLiveness = defaultLiveness;
  }
}
export class Chain {
  constructor(private state: Partial<state.Chain>) {}
  erc20s(address: string): Erc20 {
    if (!this.state?.erc20s) this.state.erc20s = {};
    if (!this.state.erc20s?.[address]) this.state.erc20s[address] = {};
    return new Erc20(this.state.erc20s[address]);
  }
  optimisticOracle(): OptimisticOracle {
    if (!this.state?.optimisticOracle) this.state.optimisticOracle = {};
    return new OptimisticOracle(this.state.optimisticOracle);
  }
}
export class Inputs {
  constructor(private state: Partial<state.Inputs>) {}
  request(requester: string, identifier: string, timestamp: number, ancillaryData: string): void {
    this.state.request = { requester, identifier, timestamp, ancillaryData };
  }
}

export default class Writer {
  constructor(private state: state.State) {}
  chains(chainId: number): Chain {
    if (!this.state?.chains) this.state.chains = {};
    if (!this.state?.chains?.[chainId]) this.state.chains[chainId] = {};
    return new Chain(this.state.chains[chainId]);
  }
  user(): User {
    if (!this.state.user) this.state.user = {};
    return new User(this.state.user);
  }
  inputs(): Inputs {
    if (!this.state.inputs) this.state.inputs = {};
    return new Inputs(this.state.inputs);
  }
}
