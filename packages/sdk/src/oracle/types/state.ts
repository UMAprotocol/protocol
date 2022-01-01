import { Signer, BigNumber } from "./ethers";

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
  };
};

export type Erc20Props = {
  address: string;
  symbol: string;
  name: string;
  decimals: string;
  totalSupply: string;
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
  inputs: Partial<Inputs>;
  user: Partial<User>;
  chains: Record<number, Partial<Chain>>;
}>;
