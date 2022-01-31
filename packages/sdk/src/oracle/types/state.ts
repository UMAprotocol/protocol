import { JsonRpcSigner, BigNumber, Web3Provider, FallbackProvider } from "./ethers";
import type { erc20, optimisticOracle } from "../services";
import type Multicall2 from "../../multicall2";
import { Context, Memory } from "./statemachine";

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
};

// partial config lets user omit some fields which we can infer internally using contracts-frontend
export type PartialChainConfig = PartialBy<ChainConfig, "optimisticOracleAddress" | "chainId" | "checkTxIntervalSec">;

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
  MissingRequest = "MissingRequest", // the client does not know the request, use client.setActiveRequest
  MissingUser = "MissingUser", // client does not have user data, use client.setUser
  WrongChain = "WrongChain", // user and request chain ids do not match, switch chains with client.switchOrAddChain
  CanPropose = "CanPropose", // The on chain request is in a state where someone could propose, use client.proposePrice
  CanDispute = "CanDispute", // The on chain request is in a state where someone could dispute, use client.disputePrice
  CanSettle = "CanSettle", // The on chain request is in a stae where someone could settle the request.
  InDvmVote = "InDvmVote", // Proposed answer has been disputed and passed to dvm for full vote.
  RequestSettled = "RequestSettled", // Request is finalized, no more changes.
  InsufficientBalance = "InsufficientBalance", // The user does not have enough balance to cover bond collateral for dispute/propose
  InsufficientApproval = "InsufficientApproval", // The oracle contract does not have enough approval to cover bond for dispute/propose, use client.approve
  ChainChangeInProgress = "ChainChangeInProgress", // The user is changing his chain
  ProposalTxInProgress = "ProposalTxInProgress", // The user is sending a proposal tx
  ApprovalTxInProgress = "ApprovalTxInProgress", // The user is sending an approval tx
  DisputeTxInProgress = "DisputeTxInProgress", // The user is sending a dispute tx
}
export type Flags = Record<Flag, boolean>;

export type InputRequest = {
  requester: string;
  identifier: string;
  timestamp: number;
  ancillaryData: string;
  chainId: number;
};

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
  currentTime: BigNumber;
};

export type State = Partial<{
  error?: Error;
  inputs: Partial<Inputs>;
  chains: Record<number, Partial<Chain>>;
  config: Config;
  services: Services;
  commands?: Record<string, Context<unknown, unknown & Memory>>;
}>;
