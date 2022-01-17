import { Signer, BigNumber } from "./ethers";
import type { erc20, optimisticOracle } from "../services";
import type Multicall2 from "../../multicall2";
import { Provider } from "./ethers";

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

export type Inputs = {
  request: {
    requester: string;
    identifier: string;
    timestamp: number;
    ancillaryData: string;
    chainId: number;
  };
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
  user: Partial<User>;
  chains: Record<number, Partial<Chain>>;
  config: Config;
  services: Services;
}>;
