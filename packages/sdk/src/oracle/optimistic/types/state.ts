import type Multicall2 from "../../../multicall2";
import {
  RequestState,
  RequestKey,
  Request as RequestByEvent,
  RequestPrice,
  ProposePrice,
  DisputePrice,
  Settle,
} from "../../../clients/optimisticOracle";

import { JsonRpcSigner, BigNumber, Web3Provider, FallbackProvider } from "../../common/types/ethers";
import type { erc20, optimisticOracle, sortedRequests } from "../../common/services";
import { Context, Memory } from "../../common/types/statemachine";

// create partial picker: https://stackoverflow.com/questions/43159887/make-a-single-property-optional-in-typescript
type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;
type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export { Context, Memory };

export type ChainServices = {
  multicall2: Multicall2;
  provider: FallbackProvider;
  erc20s: Record<string, erc20.Erc20>;
  optimisticOracle: optimisticOracle.OptimisticOracle;
};

export type Services = {
  sortedRequests?: sortedRequests.SortedRequests;
  chains?: Record<number, Partial<ChainServices>>;
};

// this is required data in order to add a new chain to users wallet
export type ChainMetadata = {
  chainId: number;
  chainName: string;
  // require at least 1 url
  rpcUrls: [string, ...string[]];
  blockExplorerUrls: [string, ...string[]];
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
};

export type ChainConfig = ChainMetadata & {
  checkTxIntervalSec: number;
  multicall2Address?: string;
  optimisticOracleAddress: string;
  // specify a block number which we do not care about blocks before this. This effectively prevents listing
  // requests older than this. If not specified, we will lookback to block 0 when considering request history.
  earliestBlockNumber?: number;
  maxEventRangeQuery?: number;
};

// partial config lets user omit some fields which we can infer internally using contracts-frontend
export type PartialChainConfig = PartialBy<
  ChainConfig,
  "optimisticOracleAddress" | "chainId" | "checkTxIntervalSec" | "earliestBlockNumber"
>;

// config definition
export type Config = {
  chains: Record<number, ChainConfig>;
};

export type PartialConfig = {
  chains: Record<number, PartialChainConfig>;
};

export type Balances = Record<string, BigNumber>;

export type User = {
  address: string;
  chainId: number;
  signer: JsonRpcSigner;
  provider: Web3Provider;
};

export type InputRequest = RequestKey & { chainId: number };

export type Inputs = {
  request: InputRequest;
  user: Partial<User>;
};

export type Erc20Props = {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  totalSupply: BigNumber;
};

export type Erc20 = {
  props: Partial<Erc20Props>;
  allowances: Record<string, Balances>;
  balances: Balances;
};

export { RequestState };

export type Request = {
  proposer: string;
  disputer: string;
  currency: string;
  settled: boolean;
  refundOnDispute: boolean;
  proposedPrice: BigNumber;
  resolvedPrice: BigNumber;
  expirationTime: BigNumber;
  reward: BigNumber;
  finalFee: BigNumber;
  bond: BigNumber;
  customLiveness: BigNumber;
  state: RequestState;
};

export type OptimisticOracleEvent = RequestPrice | ProposePrice | DisputePrice | Settle;

export type RequestIndex = RequestByEvent & { chainId: number };
export type RequestIndexes = RequestIndex[];
export type { RequestPrice, ProposePrice, DisputePrice, Settle };

// combine all request data into a mega request object
export type FullRequest = InputRequest &
  // we cant assume any of these props will exist if we get event before query contract
  Partial<Request> &
  // take the more specific types from the Request type by omitting overlapping properties
  Omit<
    RequestIndex,
    "proposedPrice" | "resolvedPrice" | "expirationTime" | "reward" | "finalFee" | "bond" | "customLiveness"
  >;

export type OptimisticOracle = {
  address: string;
  defaultLiveness: BigNumber;
  requests: Record<string, FullRequest>;
  events: OptimisticOracleEvent[];
};

export type Chain = {
  erc20s: Record<string, Partial<Erc20>>;
  optimisticOracle: Partial<OptimisticOracle>;
  currentTime: BigNumber;
};

export type State = Partial<{
  error: Error;
  inputs: Partial<Inputs>;
  chains: Record<number, Partial<Chain>>;
  config: Config;
  services: Services;
  commands: Record<string, Context<unknown, unknown & Memory>>;
  descendingRequests: RequestIndexes;
}>;
