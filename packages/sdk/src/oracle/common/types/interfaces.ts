import { TransactionConfirmer } from "../utils";
import * as services from "../services";
import * as stateTypes from "./state";
import * as ethersTypes from "./ethers";

export interface Client {
  setUser: (params: Partial<User>) => string;
  clearUser: () => string;
  setActiveRequest: (params: stateTypes.InputRequest) => string;
  setActiveRequestByTransaction: (params: services.statemachines.setActiveRequestByTransaction.Params) => string;
  approveCollateral: () => string;
  proposePrice: (proposedPriceDecimals: string | number) => string;
  disputePrice: () => string;
  settle: () => string;
  switchOrAddChain: () => string;
  startInterval: (delayMs: number) => void;
  stopInterval: () => void;
}

export type WriteCallback<State, Events> = (write: Write<Events>, state: State) => void;
export type RawWriteCallback<S> = (state: S) => void;
export type Emit<S> = (state: S, prev: S) => void;

export interface StoreConfig<State, Oracle, Events> {
  emit: Emit<State>;
  state: State;
  Read: NewRead<State, Oracle, Events>;
  Write: NewWrite<State, Events>;
  Has: NewHas<State>;
  Update: NewUpdate<Store<State, Oracle, Events>>;
}
export interface RawStore<S> {
  write: (cb: RawWriteCallback<S>) => void;
  writeAsync: (cb: RawWriteCallback<S>) => Promise<void>;
  read: () => S;
}
export interface Store<S, O, E> {
  config: StoreConfig<S, O, E>;
  write: (cb: WriteCallback<S, E>) => void;
  writeAsync: (cb: WriteCallback<S, E>) => Promise<void>;
  read: () => Read<O, E>;
  get: () => S;
  has: () => Has;
  update: Update;
}

export interface Update {
  all: () => Promise<void>;
  request: (params?: stateTypes.InputRequest) => Promise<void>;
  oracle: () => Promise<void>;
  userCollateralBalance: () => Promise<void>;
  collateralProps: () => Promise<void>;
  oracleAllowance: () => Promise<void>;
  balance: (chainId: number, token: string, account: string) => Promise<void>;
  allowance: (chainId: number, token: string, account: string, spender: string) => Promise<void>;
  isConfirmed: (
    chainId: number,
    hash: string,
    confirmations: number
  ) => Promise<boolean | ethersTypes.TransactionReceipt>;
  currentTime: (optionalChainId?: number) => Promise<void>;
  oracleEvents: (chainId: number, startBlock: number, endBlock?: number) => Promise<void>;
  sortedRequests: (chainId: number) => void;
  activeRequestFromEvents: (params?: stateTypes.InputRequest) => void;
}

export interface NewUpdate<S> {
  new (store: S): Update;
}
export interface NewRead<S, O, E> {
  new (state: S): Read<O, E>;
}
export interface NewWrite<S, E> {
  new (state: S): Write<E>;
}
export interface NewHas<S> {
  new (state: S): Has;
}

export interface Has {
  inputRequest: () => boolean;
  sortedRequestsService: () => boolean;
  requestChainId: () => boolean;
  userAddress: () => boolean;
  request: () => boolean;
  collateralProps: () => boolean;
  defaultLiveness: () => boolean;
  currentTime: () => boolean;
}

export interface Read<O, E> {
  chainConfig: (optionalChainId?: number) => stateTypes.ChainConfig;
  requestChainId: () => number;
  user: () => Partial<stateTypes.User>;
  userChainId: () => number;
  requestChain: (optionalChainId?: number) => Partial<stateTypes.Chain>;
  userAddress: () => string;
  oracleAddress: (optionalChainId?: number) => string;
  signer: () => ethersTypes.JsonRpcSigner;
  inputRequest: () => stateTypes.InputRequest;
  defaultLiveness: () => ethersTypes.BigNumber;
  request: () => stateTypes.FullRequest;
  collateralProps: () => Partial<stateTypes.Erc20Props>;
  userCollateralBalance: () => ethersTypes.BigNumber;
  userCollateralAllowance: () => ethersTypes.BigNumber;
  oracleService: (optionalChainId?: number) => O;
  collateralService: () => services.erc20.Erc20;
  command: (id: string) => stateTypes.Context<unknown, unknown & stateTypes.Memory>;
  tokenService: (chainId: number, address: string) => services.erc20.Erc20;
  provider: (chainId: number) => ethersTypes.Provider;
  transactionService: (chainId: number) => TransactionConfirmer;
  listCommands: () => stateTypes.Context<unknown, unknown & stateTypes.Memory>[];
  filterCommands: (search: {
    user?: string;
    done?: boolean;
  }) => stateTypes.Context<unknown, unknown & stateTypes.Memory>[];
  chain: (optionalChainId?: number) => Partial<stateTypes.Chain>;
  currentTime: (optionalChainId?: number) => ethersTypes.BigNumber;
  sortedRequestsService: () => services.sortedRequests.SortedRequests;
  oracleEvents: (chainId: number) => E[];
  listChains: () => number[];
  descendingRequests: () => stateTypes.RequestIndexes;
  findRequest: (query: stateTypes.InputRequest) => stateTypes.RequestIndex | undefined;
  filterRequests: (query: Partial<stateTypes.RequestIndex>) => stateTypes.RequestIndexes;
}

export interface Services {
  provider: (rpcUrls: string[]) => void;
  erc20s: (address: string) => void;
  optimisticOracle: (address: string) => void;
  multicall2: (multicall2Address?: string) => void;
}

export interface Inputs {
  request: (params: stateTypes.Inputs["request"]) => void;
  user: () => User;
}
export interface Chain<E> {
  erc20s: (address: string) => Erc20;
  optimisticOracle: () => OptimisticOracle<E>;
  currentTime: (currentTime: ethersTypes.BigNumber) => void;
}
export interface OptimisticOracle<E> {
  address: (address: string) => void;
  request: (request: stateTypes.FullRequest) => void;
  defaultLiveness: (defaultLiveness: ethersTypes.BigNumber) => void;
  event: (event: E) => void;
}
export interface Erc20 {
  props: (data: stateTypes.Erc20["props"]) => void;
  balance: (account: string, amount: ethersTypes.BigNumber) => void;
  allowance: (account: string, spender: string, amount: ethersTypes.BigNumber) => void;
}
export interface Balances {
  set: (address: string, amount: ethersTypes.BigNumber) => void;
}
export interface User {
  set: (data: Partial<stateTypes.User>) => void;
  clear: () => void;
  chainId: (chainId: number) => void;
  address: (address: string) => void;
  signer: (signer: ethersTypes.JsonRpcSigner) => void;
  provider: (provider: ethersTypes.Web3Provider) => void;
}

export interface Write<E> {
  chains: (chainId: number) => Chain<E>;
  inputs: () => Inputs;
  config: (config: stateTypes.Config) => void;
  services: (chainId: number) => Services;
  error: (error?: Error) => void;
  command: (context: stateTypes.Context<unknown, unknown & stateTypes.Memory>) => void;
  sortedRequestsService: () => void;
  descendingRequests: (sortedRequests: stateTypes.RequestIndexes) => void;
}

export type Factory = <State>(config: stateTypes.PartialConfig, emit: Emit<State>) => Client;
