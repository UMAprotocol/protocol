import { ethers } from "ethers";
import Multicall2 from "../../../multicall2";

import { requestId, insertOrderedAscending, eventKey, isUnique } from "../../common/utils";
import { factory as Erc20Factory } from "../../common/services/erc20";
import { OptimisticOracle as OptimisticOracleService } from "../../common/services/optimisticOracle";
import { SortedRequests } from "../../common/services/sortedRequests";
import type * as types from "../../common/types";

import * as state from "../types/state";

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
    if (data.provider) this.provider(data.provider);
  }
  clear(): void {
    delete this.state.chainId;
    delete this.state.address;
    delete this.state.signer;
    delete this.state.provider;
  }
  chainId(chainId: number): void {
    this.state.chainId = chainId;
  }
  address(address: string): void {
    this.state.address = address;
  }
  signer(signer: types.ethers.JsonRpcSigner): void {
    this.state.signer = signer;
  }
  provider(provider: types.ethers.Web3Provider): void {
    this.state.provider = provider;
  }
}
export class Balances {
  constructor(private state: Partial<state.Balances>) {}
  set(address: string, amount: types.ethers.BigNumber): void {
    this.state[address] = amount;
  }
}
export class Erc20 {
  constructor(private state: Partial<state.Erc20>) {}
  props(data: state.Erc20["props"]): void {
    this.state.props = data;
  }
  balance(account: string, amount: types.ethers.BigNumber): void {
    if (!this.state.balances) this.state.balances = {};
    new Balances(this.state.balances).set(account, amount);
  }
  allowance(account: string, spender: string, amount: types.ethers.BigNumber): void {
    if (!this.state.allowances) this.state.allowances = {};
    if (!this.state.allowances[spender]) this.state.allowances[spender] = {};
    new Balances(this.state.allowances[spender]).set(account, amount);
  }
}
export class OptimisticOracle implements types.interfaces.OptimisticOracle<state.OptimisticOracleEvent> {
  constructor(private state: Partial<state.OptimisticOracle>) {}
  address(address: string): void {
    this.state.address = address;
  }
  request(request: state.FullRequest): void {
    const id = requestId(request);
    if (!this.state.requests) this.state.requests = {};
    // merge data in rather than replace
    this.state.requests[id] = { ...this.state.requests[id], ...request };
  }
  defaultLiveness(defaultLiveness: types.ethers.BigNumber): void {
    this.state.defaultLiveness = defaultLiveness;
  }
  event(event: state.OptimisticOracleEvent): void {
    if (!this.state.events) this.state.events = [];
    // avoid duplicates
    if (isUnique(this.state.events, event, eventKey)) {
      insertOrderedAscending(this.state.events, event, eventKey);
    }
  }
}
export class Chain implements types.interfaces.Chain<state.OptimisticOracleEvent> {
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
  currentTime(currentTime: types.ethers.BigNumber): void {
    this.state.currentTime = currentTime;
  }
}
export class Inputs implements types.interfaces.Inputs {
  constructor(private state: Partial<state.Inputs>) {}
  request(params: state.Inputs["request"]): void {
    this.state.request = params;
  }
  user(): User {
    if (!this.state.user) this.state.user = {};
    return new User(this.state.user);
  }
}

export class Services implements types.interfaces.Services {
  constructor(private state: Partial<state.ChainServices>) {}
  provider(rpcUrls: string[]): void {
    if (this.state?.provider) return;
    const providers = rpcUrls.map((url) => {
      const provider = ethers.getDefaultProvider(url);
      // turn off all polling, we will poll manually
      provider.polling = false;
      return provider;
    });
    this.state.provider = new ethers.providers.FallbackProvider(providers, 1);
    // turn off all polling, we will poll manually
    this.state.provider.polling = false;
  }
  erc20s(address: string): void {
    if (!this.state?.provider) return;
    if (!this.state?.erc20s) this.state.erc20s = {};
    // only add this once
    if (this.state?.erc20s[address]) return;
    this.state.erc20s[address] = Erc20Factory(this.state.provider, address, this.state.multicall2);
  }
  optimisticOracle(address: string): void {
    if (this.state.optimisticOracle) return;
    if (!this.state.provider) return;
    this.state.optimisticOracle = new OptimisticOracleService(this.state.provider, address);
  }
  multicall2(multicall2Address?: string): void {
    if (!multicall2Address) return;
    if (this.state.multicall2) return;
    if (!this.state.provider) return;
    this.state.multicall2 = new Multicall2(multicall2Address, this.state.provider);
  }
}

/**
 * Write. The main writer class for this applications global state object. Composes classes that initialize, validate
 * and simplify changes to the global state. This class modifies state directly, and really is only useful in combination with immer.
 */
export class Write implements types.interfaces.Write<state.OptimisticOracleEvent> {
  constructor(private state: state.State) {}
  chains(chainId: number): Chain {
    if (!this.state?.chains) this.state.chains = {};
    if (!this.state?.chains?.[chainId]) this.state.chains[chainId] = {};
    return new Chain(this.state.chains[chainId]);
  }
  inputs(): Inputs {
    if (!this.state.inputs) this.state.inputs = {};
    return new Inputs(this.state.inputs);
  }
  config(config: state.Config): void {
    this.state.config = config;
  }
  services(chainId: number): Services {
    if (!this.state.services) this.state.services = {};
    if (!this.state.services.chains) this.state.services.chains = {};
    if (!this.state.services.chains[chainId]) this.state.services.chains[chainId] = {};
    return new Services(this.state.services.chains[chainId]);
  }
  error(error?: Error): void {
    this.state.error = error;
  }
  command(context: types.statemachine.Context<unknown, unknown & types.statemachine.Memory>): void {
    if (!this.state.commands) this.state.commands = {};
    this.state.commands[context.id] = context;
  }
  sortedRequestsService(): void {
    if (this.state?.services?.sortedRequests) return;
    // only want to add this once
    this.state.services = { sortedRequests: new SortedRequests() };
  }
  descendingRequests(sortedRequests: state.RequestIndexes): void {
    this.state.descendingRequests = sortedRequests;
  }
}
