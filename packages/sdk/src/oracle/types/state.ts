import { Signer, BigNumber } from "./ethers";
import type { erc20, optimisticOracle } from "../services";
import type Multicall2 from "../../multicall2";
import { Provider } from "./ethers";
import { Context, Memory } from "./statemachine";

export { Context, Memory };

export type ChainServices = {
  multicall2: Multicall2;
  provider: Provider;
  erc20s: Record<string, erc20.Erc20>;
  optimisticOracle: optimisticOracle.OptimisticOracle;
};

export type Services = {
  chains?: Record<number, Partial<ChainServices>>;
};

export type ChainConfig = {
  chainId: number;
  multicall2Address?: string;
  optimisticOracleAddress: string;
  providerUrl: string;
};

// config definition
export type Config = {
  chains: Record<number, ChainConfig>;
};

export type Balances = Record<string, BigNumber>;

export type User = {
  address: string;
  chainId: number;
  signer: Signer;
};

export enum RequestState {
  Invalid = 0, // Never requested.
  Requested, // Requested, no other actions taken.
  Proposed, // Proposed, but not expired or disputed yet.
  Expired, // Proposed, not disputed, past liveness.
  Disputed, // Disputed, but no DVM price returned yet.
  Resolved, // Disputed and DVM price is available.
  Settled, // Final price has been set in the contract (can get here from Expired or Resolved).
}

export enum Flag {
  MissingRequest = "MissingRequest",
  MissingUser = "MissingUser",
  WrongChain = "WrongChain",
  InvalidStateForPropose = "InvalidStateForPropose",
  InvalidStateForDispute = "InvalidStateForDispute",
  InsufficientBalance = "InsufficientBalance",
  InsufficientApproval = "InsufficientApproval",
  ProposalInProgress = "ProposalInProgress",
  ApprovalInProgress = "ApprovalInProgress",
  DisputeInProgress = "DisputeInProgress",
}

export type Inputs = {
  request: {
    requester: string;
    identifier: string;
    timestamp: number;
    ancillaryData: string;
    chainId: number;
  };
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
  state: number;
};

export type OptimisticOracle = {
  address: string;
  defaultLiveness: BigNumber;
  requests: Record<string, Request>;
};

export type Chain = {
  erc20s: Record<string, Partial<Erc20>>;
  optimisticOracle: Partial<OptimisticOracle>;
};

export type State = Partial<{
  error?: Error;
  inputs: Partial<Inputs>;
  chains: Record<number, Partial<Chain>>;
  config: Config;
  services: Services;
  flags?: Record<Flag, boolean>;
  commands?: Record<string, Context<unknown, any>>;
}>;
